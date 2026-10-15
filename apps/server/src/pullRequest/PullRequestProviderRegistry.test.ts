import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SourceControlProviderKind } from "@t3tools/contracts";
import { fakeSourceControlDriverInstance } from "@t3tools/source-control-testing/fakeSourceControlDriver";

import * as BuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import { BUILT_IN_SOURCE_CONTROL_DRIVER_LIST } from "../sourceControl/sourceControlDefinitions.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PullRequestProviderRegistry from "./PullRequestProviderRegistry.ts";

// Every host this build ships, each with a change request provider that needs no services.
const layerDrivers = Layer.succeed(
  BuiltInDrivers.SourceControlDrivers,
  BUILT_IN_SOURCE_CONTROL_DRIVER_LIST.map(({ kind, definition }) => ({
    driver: { kind, definition },
    instance: fakeSourceControlDriverInstance(kind),
  })),
);

const makeRegistry = (settings: ServerSettings.ServerSettingsService["Service"]) =>
  PullRequestProviderRegistry.make.pipe(
    Effect.provide(
      Layer.mergeAll(layerDrivers, Layer.succeed(ServerSettings.ServerSettingsService, settings)),
    ),
  );

const settingsWith = (sourceControlHosts: Record<string, Record<string, unknown>>) =>
  ServerSettings.ServerSettingsService.pipe(
    Effect.provide(ServerSettings.ServerSettingsService.layerTest({ sourceControlHosts })),
  );

it.effect("withholds the change request provider for a host Settings has switched off", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(yield* settingsWith({ forgejo: { enabled: false } }));
    const forgejo = SourceControlProviderKind.make("forgejo");

    assert.isNull(yield* registry.get(forgejo));
    // Hosts this build starts on are untouched by one host's switch.
    assert.isNotNull(yield* registry.get(SourceControlProviderKind.make("github")));
    assert.isNotNull(yield* registry.get(SourceControlProviderKind.make("gitlab")));
    // Describing what a host would need does not depend on its switch.
    assert.isNotNull(registry.registered(forgejo));
  }),
);

it.effect("answers with the host a Settings switch turns on, without a restart", () =>
  Effect.gen(function* () {
    const settings = yield* settingsWith({ forgejo: { baseUrl: "https://codeberg.org" } });
    const registry = yield* makeRegistry(settings);
    const forgejo = SourceControlProviderKind.make("forgejo");

    assert.isNull(yield* registry.get(forgejo));

    yield* settings.updateSettings({ sourceControlHosts: { forgejo: { enabled: true } } });

    assert.isNotNull(yield* registry.get(forgejo));
  }),
);

it.effect("still answers null for a host this build does not ship", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(yield* settingsWith({}));

    assert.isNull(yield* registry.get(SourceControlProviderKind.make("gitea")));
  }),
);
