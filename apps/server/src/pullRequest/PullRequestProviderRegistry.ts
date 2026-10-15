import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { isSourceControlHostEnabled } from "@t3tools/contracts";
import type { SourceControlProviderKind } from "@t3tools/contracts";

import * as BuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import * as ServerSettings from "../serverSettings.ts";
import type { PullRequestProviderApi } from "@t3tools/source-control-core/server/PullRequestProvider";

export class PullRequestProviderRegistry extends Context.Service<
  PullRequestProviderRegistry,
  {
    /**
     * Null for a host with no implementation, or one Settings has switched off, which the
     * service reports as unsupported. Resolves against the settings as they are now, so
     * flipping the switch needs no restart.
     */
    readonly get: (kind: SourceControlProviderKind) => Effect.Effect<PullRequestProviderApi | null>;
    readonly kinds: ReadonlyArray<SourceControlProviderKind>;
  }
>()("t3/pullRequest/PullRequestProviderRegistry") {}

export function fromProviders(
  providers: ReadonlyArray<PullRequestProviderApi>,
): PullRequestProviderRegistry["Service"] {
  const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
  return {
    get: (kind) => Effect.succeed(byKind.get(kind) ?? null),
    kinds: providers.map((provider) => provider.kind),
  };
}

/**
 * @public Service construction is part of the canonical Effect module API.
 */
export const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const drivers = yield* Effect.forEach(BuiltInDrivers.BUILT_IN_SOURCE_CONTROL_DRIVERS, (driver) =>
    driver.make.pipe(Effect.map((instance) => instance.pullRequests)),
  );
  const registry = fromProviders(
    drivers.filter((provider): provider is PullRequestProviderApi => provider !== null),
  );
  // Settings unreadable is not this registry's failure to report: it answers for the hosts this
  // build ships, and with nothing read every host is on its default.
  const enabledHosts = settings.getSettings.pipe(
    Effect.map((current) => current.sourceControlHosts),
    Effect.catch((cause) =>
      Effect.as(
        Effect.logWarning("Could not read settings; source control hosts take defaults", cause),
        undefined,
      ),
    ),
  );
  return {
    ...registry,
    get: (kind: SourceControlProviderKind) =>
      registry
        .get(kind)
        .pipe(
          Effect.flatMap((provider) =>
            enabledHosts.pipe(
              Effect.map((sourceControlHosts) =>
                provider !== null && isSourceControlHostEnabled(kind, sourceControlHosts)
                  ? provider
                  : null,
              ),
            ),
          ),
        ),
  } satisfies PullRequestProviderRegistry["Service"];
});

export const layer = Layer.effect(PullRequestProviderRegistry, make).pipe(
  Layer.provide(BuiltInDrivers.layer),
);
