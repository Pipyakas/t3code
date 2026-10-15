import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

declare const __T3CODE_BUILD_UPSTREAM_VERSION__: string | undefined;

/** Fork builds only: the upstream release this build is based on, stamped at build time. */
export const buildUpstreamVersion =
  typeof __T3CODE_BUILD_UPSTREAM_VERSION__ === "undefined"
    ? ""
    : __T3CODE_BUILD_UPSTREAM_VERSION__.trim();

/**
 * The version a fork build reports to upstream clients: never below the
 * newest upstream client version seen, so upstream clients, which offer an
 * update to any server behind them, never offer to replace this fork build.
 * Fork clients announce themselves and are always told the real version.
 */
export function advertisedServerVersion(
  realVersion: string,
  highestUpstreamClientVersion: string | null,
): string {
  return highestUpstreamClientVersion !== null &&
    compareSemverVersions(highestUpstreamClientVersion, realVersion) > 0
    ? highestUpstreamClientVersion
    : realVersion;
}

// Server-lifetime record; a restart starts again from the real version and
// the first upstream client to connect raises it before it reads the config.
let highestUpstreamClientVersion: string | null = null;

export function recordUpstreamClientVersion(version: string): void {
  if (buildUpstreamVersion === "" || parseSemver(version) === null) return;
  if (
    highestUpstreamClientVersion === null ||
    compareSemverVersions(version, highestUpstreamClientVersion) > 0
  ) {
    highestUpstreamClientVersion = version;
  }
}

export function descriptorForUpstreamClient(
  descriptor: ExecutionEnvironmentDescriptor,
): ExecutionEnvironmentDescriptor {
  if (buildUpstreamVersion === "") return descriptor;
  const serverVersion = advertisedServerVersion(
    descriptor.serverVersion,
    highestUpstreamClientVersion,
  );
  return serverVersion === descriptor.serverVersion ? descriptor : { ...descriptor, serverVersion };
}
