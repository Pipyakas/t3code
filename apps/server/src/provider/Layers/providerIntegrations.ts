import { Effect, Layer } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "../Services/ServerProvider.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { ClaudeProvider } from "../Services/ClaudeProvider.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import { CodexProvider } from "../Services/CodexProvider.ts";
import { GeminiAdapter } from "../Services/GeminiAdapter.ts";
import { GeminiProvider } from "../Services/GeminiProvider.ts";
import { OpenCodeAdapter } from "../Services/OpenCodeAdapter.ts";
import { OpenCodeProvider } from "../Services/OpenCodeProvider.ts";
import { ClaudeProviderLive } from "./ClaudeProvider.ts";
import { CodexProviderLive } from "./CodexProvider.ts";
import { GeminiProviderLive } from "./GeminiProvider.ts";
import { OpenCodeProviderLive } from "./OpenCodeProvider.ts";
export { RUNTIME_PROVIDER_KINDS } from "../runtimeProviderKinds.ts";

export const RuntimeProviderLive = Layer.mergeAll(
  CodexProviderLive,
  ClaudeProviderLive,
  GeminiProviderLive,
  OpenCodeProviderLive,
);

export const loadRuntimeProviderServices = Effect.gen(function* () {
  return [
    yield* CodexProvider,
    yield* ClaudeProvider,
    yield* GeminiProvider,
    yield* OpenCodeProvider,
  ] satisfies ReadonlyArray<ServerProviderShape>;
});

export const loadRuntimeAdapterServices = Effect.gen(function* () {
  return [
    yield* CodexAdapter,
    yield* ClaudeAdapter,
    yield* GeminiAdapter,
    yield* OpenCodeAdapter,
  ] satisfies ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>;
});
