import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";
import * as CloudLink from "./CloudLink.ts";

it.effect("does not revive stored cloud links or start tunnels", () => {
  let reads = 0;
  const deps = Layer.mergeAll(
    NodeServices.layer,
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: () =>
        Effect.sync(() => {
          reads++;
          return Option.some(new TextEncoder().encode("stored-credential"));
        }),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({}),
    Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({}),
    Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({}),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({}),
    Layer.mock(CliTokenManager.CloudCliTokenManager)({}),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Unexpected relay request")),
    ),
  );
  return Effect.gen(function* () {
    const link = yield* CloudLink.CloudLink;
    expect((yield* link.linkState()).linked).toBe(false);
    expect(yield* link.startManagedTunnelIfOriginConfirmed("http://127.0.0.1:3773")).toBe(false);
    expect(yield* link.reconcileDesiredLinkIfStillDesired("http://127.0.0.1:3773")).toBeNull();
    expect(yield* link.registerManagedTunnelRecovery("http://127.0.0.1:3773")).toEqual({
      status: "not_linked",
    });
    yield* link.updatePreferences({ publishAgentActivity: true }).pipe(Effect.flip);
    expect(reads).toBe(0);
    expect(CloudLink.shouldRetryCloudLink(new Error("removed"))).toBe(false);
  }).pipe(Effect.provide(CloudLink.layer.pipe(Layer.provide(deps))));
});
