import type {
  EnvironmentId,
  ServerConfig,
  ServerInstallation,
  ServerSelfUpdateCapability,
} from "@t3tools/contracts";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

import { APP_UPSTREAM_VERSION, APP_VERSION } from "./branding";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";

export interface VersionMismatch {
  readonly clientVersion: string;
  readonly serverVersion: string;
  readonly hint: string;
}

const VERSION_MISMATCH_DISMISSALS_STORAGE_KEY = "t3code:version-mismatch-dismissals:v1";
export const IGNORED_VERSION_UPDATE_ENVIRONMENTS_STORAGE_KEY =
  "t3code:ignored-version-update-environments:v1";

const dismissedServerUpdateFailures = new WeakSet<ServerUpdateState>();

export function isServerUpdateFailureDismissed(state: ServerUpdateState): boolean {
  return state.status === "failed" && dismissedServerUpdateFailures.has(state);
}

export function dismissServerUpdateFailure(state: ServerUpdateState): void {
  if (state.status === "failed") dismissedServerUpdateFailures.add(state);
}

const VersionMismatchDismissalsSchema = Schema.Struct({
  keys: Schema.Array(Schema.String),
});

type VersionMismatchDismissals = typeof VersionMismatchDismissalsSchema.Type;

/** Environments this device never offers to update, e.g. machines running a
    different build line whose versions are not comparable with this client. */
export const IgnoredVersionUpdateEnvironmentsSchema = Schema.Array(Schema.String);

const NO_IGNORED_ENVIRONMENTS: readonly string[] = [];

/** Subscribes a component to the ignored list, so mismatches re-resolve when it changes. */
export function useIgnoredVersionUpdateEnvironments() {
  return useLocalStorage(
    IGNORED_VERSION_UPDATE_ENVIRONMENTS_STORAGE_KEY,
    NO_IGNORED_ENVIRONMENTS,
    IgnoredVersionUpdateEnvironmentsSchema,
  );
}

function isVersionUpdateIgnored(environmentId: EnvironmentId | null | undefined): boolean {
  if (!environmentId) return false;
  try {
    return (
      getLocalStorageItem(
        IGNORED_VERSION_UPDATE_ENVIRONMENTS_STORAGE_KEY,
        IgnoredVersionUpdateEnvironmentsSchema,
      ) ?? []
    ).includes(environmentId);
  } catch (error) {
    console.error("Could not read ignored version-update environments.", error);
    return false;
  }
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function versionCore(version: string): string {
  return version.replace(/[-+].*$/, "");
}

/**
 * The connected server is older than this client (or `clientVersion`). Two nightly
 * builds, or two fork builds (`<upstream>-fork.N`), compare full versions; other
 * pairs compare `major.minor.patch` only. Unparseable versions compare as strings.
 */
export function resolveVersionMismatch(
  serverVersion: string | null | undefined,
  clientVersion: string = APP_VERSION,
): VersionMismatch | null {
  const normalizedClientVersion = normalizeVersion(clientVersion);
  const normalizedServerVersion = normalizeVersion(serverVersion);
  if (!normalizedClientVersion || !normalizedServerVersion) {
    return null;
  }

  const clientCore = versionCore(normalizedClientVersion);
  const serverCore = versionCore(normalizedServerVersion);
  const clientTrain = parseSemver(normalizedClientVersion)?.prerelease[0];
  const compareFullVersions =
    (clientTrain === "nightly" || clientTrain === "fork") &&
    parseSemver(normalizedServerVersion)?.prerelease[0] === clientTrain;
  const serverIsBehind =
    parseSemver(clientCore) && parseSemver(serverCore)
      ? compareSemverVersions(
          compareFullVersions ? normalizedServerVersion : serverCore,
          compareFullVersions ? normalizedClientVersion : clientCore,
        ) < 0
      : normalizedServerVersion !== normalizedClientVersion;
  if (!serverIsBehind) {
    return null;
  }

  return {
    clientVersion: normalizedClientVersion,
    serverVersion: normalizedServerVersion,
    hint: "Version mismatch. Try syncing the client and server to the same T3 Code version.",
  };
}

export function resolveServerConfigVersionMismatch(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): VersionMismatch | null {
  if (isVersionUpdateIgnored(serverConfig?.environment.environmentId)) return null;
  return resolveVersionMismatch(
    serverConfig?.environment.serverVersion,
    comparableClientVersion(serverConfig?.environment),
  );
}

/**
 * A fork build's own version differs from the upstream release it is based on,
 * so against an upstream server (one that advertises no `upstreamVersion`)
 * it compares as that upstream release. The server is then only offered real
 * upstream updates, and the offered target is a version upstream publishes.
 */
function comparableClientVersion(
  environment: Pick<ServerConfig["environment"], "upstreamVersion"> | null | undefined,
): string {
  const upstreamVersion = normalizeVersion(APP_UPSTREAM_VERSION);
  return upstreamVersion && !environment?.upstreamVersion ? upstreamVersion : APP_VERSION;
}

export function resolveServerSelfUpdateCapability(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): ServerSelfUpdateCapability | null {
  return serverConfig?.environment.capabilities.serverSelfUpdate ?? null;
}

export function supportsDesktopAppUpdate(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): boolean {
  return serverConfig?.environment.capabilities.desktopAppUpdate === true;
}

export function manualServerUpdateCommand(
  targetVersion: string,
  installation?: ServerInstallation,
): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  if (installation?.kind === "npm-global") {
    return `npm install --global --prefix ${quote(installation.prefix)} t3@${targetVersion}`;
  }
  if (installation?.kind === "t3-launcher") {
    // An inherited T3CODE_HOME would otherwise send the update to a home the launcher is not in.
    return `${quote(installation.launcher)} update --base-dir ${quote(installation.baseDir)} ${targetVersion}`;
  }
  const runner =
    installation?.kind === "pnpm-dlx" ? "pnpm dlx" : installation?.kind === "bunx" ? "bunx" : "npx";
  return `${runner} t3@${targetVersion}`;
}

export function buildVersionMismatchDismissalKey(
  environmentId: EnvironmentId,
  mismatch: Pick<VersionMismatch, "clientVersion" | "serverVersion">,
): string {
  return `${environmentId}:${mismatch.clientVersion}:${mismatch.serverVersion}`;
}

function readVersionMismatchDismissals(): VersionMismatchDismissals {
  try {
    return (
      getLocalStorageItem(
        VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
        VersionMismatchDismissalsSchema,
      ) ?? { keys: [] }
    );
  } catch (error) {
    console.error("Could not read version-mismatch dismissals.", error);
    return { keys: [] };
  }
}

function writeVersionMismatchDismissals(document: VersionMismatchDismissals): void {
  try {
    setLocalStorageItem(
      VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
      document,
      VersionMismatchDismissalsSchema,
    );
  } catch (error) {
    console.error("Could not persist version-mismatch dismissals.", error);
  }
}

export function isVersionMismatchDismissed(dismissalKey: string | null | undefined): boolean {
  if (!dismissalKey) {
    return false;
  }
  return readVersionMismatchDismissals().keys.includes(dismissalKey);
}

export function dismissVersionMismatch(dismissalKey: string | null | undefined): void {
  if (!dismissalKey) {
    return;
  }
  const document = readVersionMismatchDismissals();
  if (document.keys.includes(dismissalKey)) {
    return;
  }
  writeVersionMismatchDismissals({
    keys: [...document.keys, dismissalKey],
  });
}
