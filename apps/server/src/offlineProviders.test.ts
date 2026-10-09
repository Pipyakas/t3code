import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { BUILT_IN_DRIVERS } from "./provider/builtInDrivers.ts";
import * as Settings from "./serverSettings.ts";

it.effect("registers only Claude, OpenCode and ACP and rejects removed instance creation", () =>
  Effect.gen(function* () {
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).toEqual([
      "claudeAgent",
      "opencode",
      "acpRegistry",
    ]);
    const settings = yield* Settings.ServerSettingsService;
    for (const driver of ["codex", "cursor", "grok", "antigravity", "pi", "muse"]) {
      const error = yield* settings
        .updateProviderInstance({
          operation: "create",
          instanceId: ProviderInstanceId.make(`removed_${driver}`),
          instance: { driver: ProviderDriverKind.make(driver), enabled: true },
        })
        .pipe(Effect.flip);
      expect(error.message).toContain("is not supported in this build");
    }
    const result = yield* settings.updateProviderInstance({
      operation: "create",
      instanceId: ProviderInstanceId.make("work"),
      instance: { driver: ProviderDriverKind.make("opencode") },
    });
    expect(result.providerInstances[ProviderInstanceId.make("work")]?.driver).toBe("opencode");
  }).pipe(Effect.provide(Settings.layerTest())),
);
