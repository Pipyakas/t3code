import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import { vi } from "vite-plus/test";
import * as Analytics from "./AnalyticsService.ts";

it.effect("never collects or sends analytics even when enabled by the environment", () => {
  const fetchFn = vi.fn<typeof fetch>();
  const dependencies = Layer.mergeAll(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          T3CODE_TELEMETRY_ENABLED: "true",
          T3CODE_POSTHOG_HOST: "https://collector.example.test",
          T3CODE_POSTHOG_KEY: "test-key",
          T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: "1",
        },
      }),
    ),
  );
  return Effect.gen(function* () {
    const analytics = yield* Analytics.AnalyticsService;
    yield* analytics.record("client.turn.requested", { model: "private-model" });
    yield* analytics.flush;
  }).pipe(
    Effect.provide(Analytics.layer.pipe(Layer.provide(dependencies))),
    Effect.andThen(Effect.sync(() => expect(fetchFn).not.toHaveBeenCalled())),
  );
});
