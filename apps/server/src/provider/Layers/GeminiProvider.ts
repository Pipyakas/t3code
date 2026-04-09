import type {
  GeminiSettings,
  ModelCapabilities,
  ServerSettingsError,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { ServerSettingsService } from "../../serverSettings";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  DEFAULT_TIMEOUT_MS,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot";
import { GeminiProvider } from "../Services/GeminiProvider";

const PROVIDER = "gemini" as const;
const DEFAULT_GEMINI_BINARIES = ["gemini", "gemini-cli"] as const;
const DEFAULT_GEMINI_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "auto-gemini-3",
    name: "Auto (Gemini 3)",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "auto-gemini-2.5",
    name: "Auto (Gemini 2.5)",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro (Preview)",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3-flash-preview",
    name: "Gemini 3 Flash (Preview)",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite (Preview)",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
];

export const GeminiProviderLive = Layer.effect(
  GeminiProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;

    const resolveGeminiBinaryCandidates = (binaryPath: string | null | undefined) => {
      const configured = binaryPath?.trim();
      return configured ? [configured] : [...DEFAULT_GEMINI_BINARIES];
    };

    const runGeminiCommand = (args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.map((s) => s.providers.gemini),
        );
        let lastError: Error = new Error("Gemini CLI binary was not found");
        for (const binaryPath of resolveGeminiBinaryCandidates(settings.binaryPath)) {
          const attempt = yield* spawnAndCollect(
            binaryPath,
            ChildProcess.make(binaryPath, [...args], {
              shell: process.platform === "win32",
            }),
          ).pipe(Effect.result);
          if (Result.isSuccess(attempt)) {
            return attempt.success;
          }
          lastError =
            attempt.failure instanceof Error ? attempt.failure : new Error(String(attempt.failure));
          if (!isCommandMissingCause(attempt.failure)) {
            return yield* Effect.fail(lastError);
          }
        }
        return yield* Effect.fail(lastError);
      });

    const checkProvider = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.map((s) => s.providers.gemini),
      );
      const checkedAt = new Date().toISOString();
      const models = providerModelsFromSettings(
        BUILT_IN_MODELS,
        PROVIDER,
        settings.customModels,
        DEFAULT_GEMINI_MODEL_CAPABILITIES,
      );

      if (!settings.enabled) {
        return buildServerProvider({
          provider: PROVIDER,
          enabled: false,
          checkedAt,
          models,
          probe: {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Gemini is disabled in T3 Code settings.",
          },
        });
      }

      const versionProbe = yield* runGeminiCommand(["--version"]).pipe(
        Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
        Effect.result,
      );

      if (Result.isFailure(versionProbe)) {
        return buildServerProvider({
          provider: PROVIDER,
          enabled: true,
          checkedAt,
          models,
          probe: {
            installed: !isCommandMissingCause(versionProbe.failure),
            version: null,
            status: "error",
            auth: { status: "unknown" },
            message: isCommandMissingCause(versionProbe.failure)
              ? "Gemini CLI (`gemini`) is not installed or not on PATH."
              : `Failed to execute Gemini CLI health check: ${versionProbe.failure instanceof Error ? versionProbe.failure.message : String(versionProbe.failure)}.`,
          },
        });
      }

      if (Option.isNone(versionProbe.success)) {
        return buildServerProvider({
          provider: PROVIDER,
          enabled: true,
          checkedAt,
          models,
          probe: {
            installed: true,
            version: null,
            status: "error",
            auth: { status: "unknown" },
            message: "Gemini CLI timed out during health check.",
          },
        });
      }

      const result = versionProbe.success.value;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parseGenericCliVersion(`${result.stdout}\n${result.stderr}`),
          status: "ready",
          auth: { status: "authenticated" },
        },
      });
    });

    return yield* makeManagedServerProvider<GeminiSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.gemini),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.gemini),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider: checkProvider as Effect.Effect<ServerProvider, ServerSettingsError>,
    });
  }),
);
