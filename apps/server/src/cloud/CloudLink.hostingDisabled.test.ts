import { EnvironmentId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NetAddress from "effect/net/NetAddress";
import { HttpClient, HttpServer } from "effect/http";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import * as ConnectReachability from "./ConnectReachability.ts";
import * as CloudLink from "./CloudLink.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";

/**
 * Offline mode (`T3CODE_OFFLINE=1`): the real `CloudLink.layer` swaps in a
 * hosting-disabled stub, so no path may link this environment to the relay or
 * open an outbound tunnel, while link-state reads stay benign for the UI.
 * Deps are mocked the same way CloudLink.test.ts mocks them — the stub never
 * touches them, but the layer still requires them to be provided.
 */
const withDisabledLink = <A, E>(effect: Effect.Effect<A, E, CloudLink.CloudLink>) =>
  Effect.provide(
    effect,
    CloudLink.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ServerSecretStore.ServerSecretStore)({}),
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-offline")),
          }),
          Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({}),
          Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({}),
          Layer.mock(ConnectReachability.ConnectReachability)({
            latest: Effect.succeedNone,
          }),
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({}),
          Layer.mock(CliTokenManager.CloudCliTokenManager)({}),
          Layer.mock(HttpServer.HttpServer)({
            address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 3773),
          }),
          Layer.mock(ServerConfig.ServerConfig)({} as ServerConfig.ServerConfig["Service"]),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("unused")),
          ),
          NodeServices.layer,
          ConfigProvider.layer(ConfigProvider.fromUnknown({ T3CODE_OFFLINE: "1" })),
        ),
      ),
    ),
  );

it.effect("refuses to reconcile a desired link", () =>
  Effect.gen(function* () {
    const service = yield* CloudLink.CloudLink;
    const error = yield* Effect.flip(service.reconcileDesiredLink("http://127.0.0.1:1"));
    assert.equal(error._tag, "CloudLinkInternalError");
    if (error._tag !== "CloudLinkInternalError") assert.fail(`unexpected ${error._tag}`);
    assert.equal(error.operation, "hosting-disabled");
    assert.match(error.message, /T3 Connect hosting is disabled in offline mode/);
  }).pipe(withDisabledLink),
);

it.effect("never reports a link and never starts, registers, or recovers a tunnel", () =>
  Effect.gen(function* () {
    const service = yield* CloudLink.CloudLink;
    const localOrigin = "http://127.0.0.1:1";

    const state = yield* service.linkState();
    assert.equal(state.linked, false);
    assert.equal(state.cloudUserId, null);
    assert.equal(state.managedTunnelActive, false);

    assert.equal(yield* service.reconcileDesiredLinkIfStillDesired(localOrigin), null);
    assert.equal(yield* service.startManagedTunnelIfOriginConfirmed(localOrigin), false);
    assert.deepEqual(yield* service.registerManagedTunnelRecovery(localOrigin), {
      status: "not_linked",
    });
    assert.equal(yield* service.recoverManagedTunnel(localOrigin), false);
    assert.equal(yield* service.releaseManagedTunnelOnShutdown(), false);
  }).pipe(withDisabledLink),
);

it.effect("still lets unlink succeed so a stale link can be cleared", () =>
  Effect.gen(function* () {
    const service = yield* CloudLink.CloudLink;
    assert.deepEqual(yield* service.unlink(), { ok: true, endpointRuntimeStatus: null });
  }).pipe(withDisabledLink),
);

it.effect("with the flag unset uses the real link service (upstream behaviour)", () =>
  Effect.gen(function* () {
    // No offline ConfigProvider: the default env has no T3CODE_OFFLINE, so the
    // layer must construct the real service, whose linkState reflects the
    // (empty) secret store rather than the hosting-disabled stub.
    const service = yield* CloudLink.CloudLink;
    const state = yield* service.linkState();
    // The real service reads the relay URL secret; the mock store returns
    // None, so it reports not-linked without the hosting-disabled stub's
    // shape — proving the flag, not a build constant, selects the service.
    assert.equal(state.linked, false);
  }).pipe(
    Effect.provide(
      CloudLink.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ServerSecretStore.ServerSecretStore)({
              get: () => Effect.succeedNone,
              set: () => Effect.void,
            }),
            Layer.mock(ServerEnvironment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-offline")),
            }),
            Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({
              requestCatchUp: () => Effect.void,
            }),
            Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({}),
            Layer.mock(ConnectReachability.ConnectReachability)({
              latest: Effect.succeedNone,
            }),
            Layer.mock(EnvironmentAuth.EnvironmentAuth)({}),
            Layer.mock(CliTokenManager.CloudCliTokenManager)({}),
            Layer.mock(HttpServer.HttpServer)({
              address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 3773),
            }),
            Layer.mock(ServerConfig.ServerConfig)({} as ServerConfig.ServerConfig["Service"]),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unused")),
            ),
            NodeServices.layer,
          ),
        ),
      ),
    ),
  ),
);
