import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as RemovedConnect from "./removedConnect.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";

it.effect(
  "rejects tunnel installation and reports it absent without any network or filesystem services",
  () =>
    Effect.gen(function* () {
      expect(yield* RemovedConnect.relayClientStatus).toEqual({
        status: "missing",
        version: "removed",
      });
      const error = yield* RemovedConnect.installRelayClient.pipe(Stream.runCollect, Effect.flip);
      expect(error.reason).toBe("removed");
      expect(error.message).toContain("T3 Connect is removed");
    }),
);

it.effect("never starts a tunnel even when a stored connector token is supplied", () =>
  Effect.gen(function* () {
    const runtime = yield* ManagedEndpointRuntime.CloudManagedEndpointRuntime;
    expect(
      yield* runtime.applyConfig({
        providerKind: "cloudflare_tunnel",
        connectorToken: "stored-token",
      }),
    ).toEqual({ status: "disabled" });
    yield* runtime.requestRecovery({
      providerKind: "cloudflare_tunnel",
      connectorToken: "stored-token",
    });
    expect(Array.from(yield* Stream.runCollect(runtime.recoveryRequests))).toEqual([]);
  }).pipe(Effect.provide(ManagedEndpointRuntime.layer)),
);
