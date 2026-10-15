/**
 * Effort ladders for models served by an Anthropic-compatible gateway.
 *
 * With `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` on, Claude Code lists the
 * gateway's models but keeps only their ids and names, then reports the same
 * generic effort ladder for every one of them. Gateways that know better say so
 * on `GET /v1/models` (`supported_effort`, or `reasoning_options` of type
 * `effort`), so the driver reads that list itself and lets it replace what
 * Claude Code reported.
 *
 * @module provider/claudeGatewayModels
 */
import type { ModelInfo as ClaudeModelInfo } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

type ClaudeEffortLevel = NonNullable<ClaudeModelInfo["supportedEffortLevels"]>[number];

/** The effort levels Claude Code accepts, lowest first. */
export const CLAUDE_EFFORT_LEVELS: ReadonlyArray<ClaudeEffortLevel> = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface ClaudeGatewayConnection {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * What one gateway says about its models: the effort levels each id accepts,
 * or `null` for an id it serves without reasoning (no effort control). A
 * reasoning model the gateway publishes no ladder for is left out, so Claude
 * Code's own report stands for it.
 */
export type ClaudeGatewayEffortLevels = ReadonlyMap<
  string,
  ReadonlyArray<ClaudeEffortLevel> | null
>;

export class ClaudeGatewayModelsError extends Schema.TaggedError<ClaudeGatewayModelsError>()(
  "ClaudeGatewayModelsError",
  { status: Schema.Int },
) {}

const ClaudeSettingsEnv = Schema.Struct({
  env: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const GatewayModelList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      reasoning: Schema.optional(Schema.NullOr(Schema.Boolean)),
      supported_effort: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      reasoning_options: Schema.optional(
        Schema.NullOr(
          Schema.Array(
            Schema.Struct({
              type: Schema.String,
              values: Schema.optional(Schema.Array(Schema.String)),
            }),
          ),
        ),
      ),
    }),
  ),
});

function isDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "0" || normalized === "false";
}

/**
 * The gateway Claude Code would discover models from, given the process
 * environment and the `env` block of Claude's user `settings.json` (which
 * Claude Code applies over the process environment). `undefined` when
 * discovery is off or no base URL is set.
 */
export function resolveClaudeGatewayConnection(
  processEnv: NodeJS.ProcessEnv,
  settingsEnv: Readonly<Record<string, unknown>>,
): ClaudeGatewayConnection | undefined {
  const read = (name: string) => {
    const fromSettings = settingsEnv[name];
    return typeof fromSettings === "string" ? fromSettings : processEnv[name];
  };
  if (isDisabled(read("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"))) return undefined;
  const baseUrl = read("ANTHROPIC_BASE_URL")?.trim().replace(/\/+$/, "");
  if (!baseUrl) return undefined;

  const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
  const authToken = read("ANTHROPIC_AUTH_TOKEN")?.trim();
  const apiKey = read("ANTHROPIC_API_KEY")?.trim();
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  else if (apiKey) headers["x-api-key"] = apiKey;
  // Claude Code's format: one `Name: value` per line.
  for (const line of read("ANTHROPIC_CUSTOM_HEADERS")?.split(/\r?\n/) ?? []) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name) headers[name.toLowerCase()] = value;
  }
  return { baseUrl, headers };
}

/** Reads the `env` block of Claude's user settings; empty when absent or unreadable. */
export const readClaudeSettingsEnv = Effect.fn("readClaudeSettingsEnv")(function* (
  configDir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem.readFileString(path.join(configDir, "settings.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ClaudeSettingsEnv))),
    Effect.map((settings): Readonly<Record<string, unknown>> => settings.env ?? {}),
    Effect.orElseSucceed((): Readonly<Record<string, unknown>> => ({})),
  );
});

function toClaudeEffortLevels(values: ReadonlyArray<string>): ReadonlyArray<ClaudeEffortLevel> {
  const declared = new Set(values);
  return CLAUDE_EFFORT_LEVELS.filter((level) => declared.has(level));
}

/** Effort levels per model id from the gateway's `/v1/models`. */
export const fetchClaudeGatewayEffortLevels = Effect.fn("fetchClaudeGatewayEffortLevels")(
  function* (connection: ClaudeGatewayConnection) {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http.execute(
      HttpClientRequest.get(`${connection.baseUrl}/v1/models`).pipe(
        HttpClientRequest.setHeaders(connection.headers),
      ),
    );
    if (response.status !== 200) {
      return yield* new ClaudeGatewayModelsError({ status: response.status });
    }
    const list = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(GatewayModelList)),
    );
    const levels: Map<string, ReadonlyArray<ClaudeEffortLevel> | null> = new Map();
    for (const model of list.data) {
      const declared =
        model.supported_effort ??
        model.reasoning_options?.find((option) => option.type === "effort")?.values ??
        [];
      const effortLevels = toClaudeEffortLevels(declared);
      if (effortLevels.length > 0) levels.set(model.id, effortLevels);
      // A ladder implies reasoning, even one with no level Claude Code accepts.
      else if (model.reasoning !== true && declared.length === 0) levels.set(model.id, null);
    }
    const result: ClaudeGatewayEffortLevels = levels;
    return result;
  },
  Effect.timeout("5 seconds"),
);

/**
 * Replace Claude Code's effort report with the gateway's for every model the
 * gateway lists. Models it does not list (Anthropic's own, or ids it no longer
 * serves) keep what Claude Code reported.
 */
export function withClaudeGatewayEffortLevels(
  models: ReadonlyArray<ClaudeModelInfo>,
  gateway: ClaudeGatewayEffortLevels,
): ReadonlyArray<ClaudeModelInfo> {
  return models.map((info) => {
    if (!gateway.has(info.value)) return info;
    const levels = gateway.get(info.value) ?? null;
    if (levels === null) {
      const { supportedEffortLevels: _levels, ...rest } = info;
      return { ...rest, supportsEffort: false };
    }
    return { ...info, supportsEffort: true, supportedEffortLevels: [...levels] };
  });
}
