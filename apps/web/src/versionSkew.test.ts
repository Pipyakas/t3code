import { EnvironmentId } from "@t3tools/contracts";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Pinned so the direction cases below read as fixed versions instead of
// arithmetic on whatever version this checkout happens to be at.
const branding = vi.hoisted(() => ({
  APP_VERSION: "0.0.34",
  APP_UPSTREAM_VERSION: null as string | null,
}));
vi.mock("./branding", () => branding);

import { APP_VERSION } from "./branding";
import { setLocalStorageItem } from "./hooks/useLocalStorage";
import {
  IGNORED_VERSION_UPDATE_ENVIRONMENTS_STORAGE_KEY,
  IgnoredVersionUpdateEnvironmentsSchema,
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  manualServerUpdateCommand,
  resolveServerConfigVersionMismatch,
  resolveVersionMismatch,
} from "./versionSkew";

const MISMATCH_HINT =
  "Version mismatch. Try syncing the client and server to the same T3 Code version.";

describe("versionSkew", () => {
  it("updates only the proven npm prefix and safely quotes its path", () => {
    expect(manualServerUpdateCommand("0.0.45", { kind: "npm-global", prefix: "/opt/node" })).toBe(
      "npm install --global --prefix '/opt/node' t3@0.0.45",
    );
    expect(
      manualServerUpdateCommand("0.0.45", { kind: "npm-global", prefix: "/opt/maria's node" }),
    ).toBe("npm install --global --prefix '/opt/maria'\\''s node' t3@0.0.45");
  });
  beforeEach(() => {
    branding.APP_VERSION = "0.0.34";
    branding.APP_UPSTREAM_VERSION = null;
  });

  it("dismisses only the current failed attempt without clearing its retry state", () => {
    const failure = {
      status: "failed",
      stage: "downloading",
      fromVersion: "0.0.33",
      targetVersion: "0.0.34",
      message: "Download failed.",
    } as const satisfies ServerUpdateState;
    const retryFailure = { ...failure };
    const otherEnvironmentFailure = { ...failure };

    dismissServerUpdateFailure(failure);

    expect(isServerUpdateFailureDismissed(failure)).toBe(true);
    expect(failure.status).toBe("failed");
    expect(failure.message).toBe("Download failed.");
    expect(isServerUpdateFailureDismissed(retryFailure)).toBe(false);
    expect(isServerUpdateFailureDismissed(otherEnvironmentFailure)).toBe(false);
  });

  it("returns a mismatch when the server is behind the client", () => {
    expect(resolveVersionMismatch("0.0.33")).toEqual({
      clientVersion: "0.0.34",
      serverVersion: "0.0.33",
      hint: MISMATCH_HINT,
    });
  });

  it("does not warn when the server is ahead of the client", () => {
    expect(resolveVersionMismatch("0.0.35")).toBeNull();
    expect(resolveVersionMismatch("9.9.9")).toBeNull();
  });

  it("does not warn when a nightly and a stable build share a core version", () => {
    expect(resolveVersionMismatch("0.0.34-nightly.20260818.1124")).toBeNull();

    branding.APP_VERSION = "0.0.34-nightly.20260818.1124";
    expect(resolveVersionMismatch("0.0.34")).toBeNull();
  });

  it.each(["0.0.34-nightly.20260823.1124", "0.0.34-nightly.20260824.1124"])(
    "warns when nightly server %s is behind a nightly client on the same release",
    (serverVersion) => {
      branding.APP_VERSION = "0.0.34-nightly.20260824.1125";

      expect(resolveVersionMismatch(serverVersion)).toEqual({
        clientVersion: "0.0.34-nightly.20260824.1125",
        serverVersion,
        hint: MISMATCH_HINT,
      });
    },
  );

  // regression: #7579 versions were compared as strings, not semver
  it("treats a nightly server built past the client as ahead, not skew", () => {
    expect(resolveVersionMismatch("0.0.35-nightly.20260818.1124")).toBeNull();
  });

  it("still warns when a nightly client outruns the server by a release", () => {
    branding.APP_VERSION = "0.0.35-nightly.20260818.1124";

    expect(resolveVersionMismatch("0.0.34")).toEqual({
      clientVersion: "0.0.35-nightly.20260818.1124",
      serverVersion: "0.0.34",
      hint: MISMATCH_HINT,
    });
  });

  it("falls back to string inequality when a version is not semver", () => {
    expect(resolveVersionMismatch("dev")).toEqual({
      clientVersion: "0.0.34",
      serverVersion: "dev",
      hint: MISMATCH_HINT,
    });

    branding.APP_VERSION = "dev";
    expect(resolveVersionMismatch("dev")).toBeNull();
    expect(resolveVersionMismatch("0.0.34")).toMatchObject({ serverVersion: "0.0.34" });
  });

  it("keys dismissals by environment, client version, and server version", () => {
    const environmentId = EnvironmentId.make("environment-dismissal");
    const key = buildVersionMismatchDismissalKey(environmentId, {
      clientVersion: APP_VERSION,
      serverVersion: "9.9.9",
    });

    expect(isVersionMismatchDismissed(key)).toBe(false);

    dismissVersionMismatch(key);

    expect(isVersionMismatchDismissed(key)).toBe(true);
    expect(
      isVersionMismatchDismissed(
        buildVersionMismatchDismissalKey(environmentId, {
          clientVersion: APP_VERSION,
          serverVersion: "9.9.10",
        }),
      ),
    ).toBe(false);
  });

  it("never reports a mismatch for environments whose updates are ignored", () => {
    const config = (id: string) => ({
      environment: {
        environmentId: EnvironmentId.make(id),
        label: "Remote",
        platform: { os: "windows", arch: "x64" } as const,
        serverVersion: "0.0.33",
        capabilities: { repositoryIdentity: true },
      },
    });
    setLocalStorageItem(
      IGNORED_VERSION_UPDATE_ENVIRONMENTS_STORAGE_KEY,
      ["environment-ignored"],
      IgnoredVersionUpdateEnvironmentsSchema,
    );

    expect(resolveServerConfigVersionMismatch(config("environment-ignored"))).toBeNull();
    expect(resolveServerConfigVersionMismatch(config("environment-other"))).toMatchObject({
      serverVersion: "0.0.33",
    });
  });

  it("compares a fork client with upstream servers as its upstream base", () => {
    branding.APP_VERSION = "0.0.46-nightly.20261010.2948";
    branding.APP_UPSTREAM_VERSION = "0.0.46-nightly.20261010.2945";
    const config = (serverVersion: string, upstreamVersion?: string) => ({
      environment: {
        environmentId: EnvironmentId.make("environment-1"),
        label: "Remote",
        platform: { os: "windows", arch: "x64" } as const,
        serverVersion,
        ...(upstreamVersion === undefined ? {} : { upstreamVersion }),
        capabilities: { repositoryIdentity: true },
      },
    });

    expect(resolveServerConfigVersionMismatch(config("0.0.46-nightly.20261010.2945"))).toBeNull();
    expect(resolveServerConfigVersionMismatch(config("0.0.46-nightly.20261009.2939"))).toEqual({
      clientVersion: "0.0.46-nightly.20261010.2945",
      serverVersion: "0.0.46-nightly.20261009.2939",
      hint: MISMATCH_HINT,
    });
    // A fork server on the same base is still offered the newer fork build.
    expect(
      resolveServerConfigVersionMismatch(
        config("0.0.46-nightly.20261010.2945", "0.0.46-nightly.20261010.2945"),
      ),
    ).toMatchObject({ clientVersion: "0.0.46-nightly.20261010.2948" });
  });

  it("compares fork builds on the same upstream base by their fork release", () => {
    branding.APP_VERSION = "0.1.0-fork.2";
    branding.APP_UPSTREAM_VERSION = "0.1.0";
    const config = (serverVersion: string, upstreamVersion?: string) => ({
      environment: {
        environmentId: EnvironmentId.make("environment-1"),
        label: "Remote",
        platform: { os: "linux", arch: "x64" } as const,
        serverVersion,
        ...(upstreamVersion === undefined ? {} : { upstreamVersion }),
        capabilities: { repositoryIdentity: true },
      },
    });

    expect(resolveServerConfigVersionMismatch(config("0.1.0-fork.1", "0.1.0"))).toMatchObject({
      clientVersion: "0.1.0-fork.2",
      serverVersion: "0.1.0-fork.1",
    });
    expect(resolveServerConfigVersionMismatch(config("0.1.0-fork.3", "0.1.0"))).toBeNull();
    // A fork server still on a nightly base is a release behind.
    expect(
      resolveServerConfigVersionMismatch(
        config("0.0.46-nightly.20261015.3172", "0.0.46-nightly.20261015.3171"),
      ),
    ).toMatchObject({ clientVersion: "0.1.0-fork.2" });
    // Upstream's own release is the base, not something to replace.
    expect(resolveServerConfigVersionMismatch(config("0.1.0"))).toBeNull();
  });
});
