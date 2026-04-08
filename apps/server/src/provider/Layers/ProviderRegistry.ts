/**
 * ProviderRegistryLive - Aggregates provider-specific snapshot services.
 *
 * @module ProviderRegistryLive
 */
import type { ProviderKind, ServerProvider } from "@t3tools/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import {
  RUNTIME_PROVIDER_KINDS,
  RuntimeProviderLive,
  loadRuntimeProviderServices,
} from "./providerIntegrations";
import type { ServerProviderShape } from "../Services/ServerProvider";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry";

const loadProviders = (
  providers: ReadonlyArray<ServerProviderShape>,
): Effect.Effect<ReadonlyArray<ServerProvider>> =>
  Effect.all(
    providers.map((provider) => provider.getSnapshot),
    {
      concurrency: "unbounded",
    },
  );

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const runtimeProviders = yield* loadRuntimeProviderServices;
    const runtimeProviderByKind = new Map<ProviderKind, ServerProviderShape>();
    RUNTIME_PROVIDER_KINDS.forEach((kind, index) => {
      runtimeProviderByKind.set(kind, runtimeProviders[index]!);
    });
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
      yield* loadProviders(runtimeProviders),
    );

    const syncProviders = Effect.fn("syncProviders")(function* (options?: {
      readonly publish?: boolean;
    }) {
      const previousProviders = yield* Ref.get(providersRef);
      const providers = yield* loadProviders(runtimeProviders);
      yield* Ref.set(providersRef, providers);

      if (options?.publish !== false && haveProvidersChanged(previousProviders, providers)) {
        yield* PubSub.publish(changesPubSub, providers);
      }

      return providers;
    });

    for (const runtimeProvider of runtimeProviders) {
      yield* Stream.runForEach(runtimeProvider.streamChanges, () => syncProviders()).pipe(
        Effect.forkScoped,
      );
    }

    const refresh = Effect.fn("refresh")(function* (provider?: ProviderKind) {
      const selectedProvider = provider ? runtimeProviderByKind.get(provider) : undefined;
      if (selectedProvider) {
        yield* selectedProvider.refresh;
      } else {
        yield* Effect.all(
          runtimeProviders.map((runtimeProvider) => runtimeProvider.refresh),
          {
            concurrency: "unbounded",
          },
        );
      }

      return yield* syncProviders();
    });

    return {
      getProviders: syncProviders({ publish: false }).pipe(
        Effect.tapError(Effect.logError),
        Effect.orElseSucceed(() => []),
      ),
      refresh: (provider?: ProviderKind) =>
        refresh(provider).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => []),
        ),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
).pipe(Layer.provide(RuntimeProviderLive));
