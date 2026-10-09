import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import { vi } from "vite-plus/test";
import * as Relay from "./managedRelay.ts";

it.effect("cannot enable relay traffic with a configured URL or token", () => {
  const fetchFn = vi.fn<typeof fetch>();
  const deps = Layer.mergeAll(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    Layer.mock(Relay.ManagedRelayDpopSigner)({}),
  );
  return Effect.gen(function* () {
    const relay = yield* Relay.make({ relayUrl: "https://relay.example.test", clientId: "t3-web" });
    const error = yield* relay
      .listEnvironments({ clerkToken: "persisted-token" })
      .pipe(Effect.flip);
    expect(error._tag).toBe("ManagedRelayUrlInvalidError");
    yield* relay.listDevices({ clerkToken: "persisted-token" }).pipe(Effect.flip);
    yield* relay.getAgentActivitySnapshot({ clerkToken: "persisted-token" }).pipe(Effect.flip);
    expect(fetchFn).not.toHaveBeenCalled();
  }).pipe(Effect.provide(deps));
});
