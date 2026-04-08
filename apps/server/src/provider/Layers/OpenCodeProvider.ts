import type {
  ModelCapabilities,
  OpenCodeSettings,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

import {
  DEFAULT_TIMEOUT_MS,
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { OpenCodeProvider } from "../Services/OpenCodeProvider";
import { ServerSettingsService } from "../../serverSettings";
import { ServerSettingsError } from "@t3tools/contracts";

const OPENAI_EFFORT_LEVELS = [
  { value: "xhigh", label: "Extra High" },
  { value: "high", label: "High", isDefault: true },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const OPENCODE_GO_EFFORT_LEVELS = [
  { value: "high", label: "High", isDefault: true },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const DEFAULT_OPENCODE_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const PROVIDER = "opencode" as const;
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  // Free models
  {
    slug: "opencode/minimax-m2.5-free",
    name: "MiniMax M2.5 Free",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  {
    slug: "opencode/big-pickle",
    name: "Big Pickle",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  {
    slug: "opencode/nemotron-3-super-free",
    name: "Nemotron 3 Super Free",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: [
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
    },
  },
  // OpenCode Go models
  {
    slug: "opencode-go/glm-5",
    name: "GLM-5 (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  {
    slug: "opencode-go/glm-5.1",
    name: "GLM-5.1 (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  {
    slug: "opencode-go/kimi-k2.5",
    name: "Kimi K2.5 (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  {
    slug: "opencode-go/mimo-v2-omni",
    name: "Mimo V2 Omni (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  {
    slug: "opencode-go/mimo-v2-pro",
    name: "Mimo V2 Pro (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  {
    slug: "opencode-go/minimax-m2.5",
    name: "MiniMax M2.5 (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  {
    slug: "opencode-go/minimax-m2.7",
    name: "MiniMax M2.7 (Go)",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENCODE_GO_EFFORT_LEVELS,
    },
  },
  // OpenAI models
  {
    slug: "openai/codex-mini-latest",
    name: "Codex Mini Latest",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5-codex",
    name: "GPT-5 Codex",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.2",
    name: "GPT-5.2",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
  {
    slug: "openai/gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: {
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      reasoningEffortLevels: OPENAI_EFFORT_LEVELS,
    },
  },
];

const runOpenCodeCommand = Effect.fn("runOpenCodeCommand")((args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;
    const opencodeSettings = yield* settingsService.getSettings.pipe(
      Effect.map((settings) => settings.providers.opencode),
    );
    const command = ChildProcess.make(opencodeSettings.binaryPath, [...args], {
      shell: process.platform === "win32",
    });
    return yield* spawnAndCollect(opencodeSettings.binaryPath, command);
  }),
);

export const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(function* () {
  const settingsService = yield* ServerSettingsService;
  const opencodeSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => settings.providers.opencode),
  );
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    opencodeSettings.customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );

  if (!opencodeSettings.enabled) {
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
        message: "OpenCode is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runOpenCodeCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: opencodeSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "OpenCode CLI (`opencode`) is not installed or not on PATH."
          : `Failed to execute OpenCode CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: opencodeSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "OpenCode CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion =
    parseGenericCliVersion(version.stdout) ?? parseGenericCliVersion(version.stderr);

  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: opencodeSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `OpenCode CLI is installed but failed to run. ${detail}`
          : "OpenCode CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: opencodeSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
});

export const makeOpenCodeProviderLive = (_options?: { readonly timeoutMs?: number }) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;

    return yield* makeManagedServerProvider<OpenCodeSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.opencode),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.opencode),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider: checkOpenCodeProviderStatus() as Effect.Effect<
        ServerProvider,
        ServerSettingsError
      >,
    });
  });

export const OpenCodeProviderLive = Layer.effect(OpenCodeProvider, makeOpenCodeProviderLive());
