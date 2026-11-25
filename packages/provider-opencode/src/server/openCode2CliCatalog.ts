import * as Effect from "effect/Effect";
import type * as Path from "effect/Path";

import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import type { OpenCode2Model } from "./status.ts";

const CLI_MODEL_TIMEOUT = "30 seconds";

const GATEWAY_ALIASES = new Map([
  ["opencode", "opencode-go"],
  ["opencode-go", "opencode"],
]);

const GATEWAY_PROVIDER_NAMES = new Map([
  ["opencode", "OpenCode"],
  ["opencode-go", "OpenCode Go"],
]);

export interface OpenCodeModelSlug {
  readonly providerID: string;
  readonly id: string;
}

/** The CLI prints one `provider/model` slug per line; ids may themselves contain `/`. */
export const parseOpenCodeModelList = (output: string): ReadonlyArray<OpenCodeModelSlug> => {
  const seen = new Set<string>();
  const models: Array<OpenCodeModelSlug> = [];
  for (const line of output.split(/\r?\n/)) {
    const slug = line.trim();
    const separator = slug.indexOf("/");
    if (separator <= 0 || separator === slug.length - 1 || /\s/.test(slug) || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    models.push({ providerID: slug.slice(0, separator), id: slug.slice(separator + 1) });
  }
  return models;
};

export const readOpenCodeCliModelSlugs = Effect.fn("readOpenCodeCliModelSlugs")(function* (input: {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly serverUrl?: string | undefined;
  readonly serverPassword?: string | undefined;
}) {
  const runtime = yield* OpenCodeRuntime.OpenCodeRuntime;
  const args =
    input.serverUrl === undefined || input.serverUrl.trim().length === 0
      ? ["models", "--standalone"]
      : ["models", "--server", input.serverUrl.trim()];
  const environment =
    input.serverPassword && input.serverUrl
      ? { ...input.environment, OPENCODE_PASSWORD: input.serverPassword }
      : input.environment;
  const command = runtime
    .runOpenCodeCommand({ binaryPath: input.binaryPath, args, environment, cwd: input.cwd })
    .pipe(
      Effect.timeoutOrElse({
        duration: CLI_MODEL_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new OpenCodeRuntime.OpenCodeRuntimeError({
              operation: "models",
              detail: `OpenCode's model list did not finish within ${CLI_MODEL_TIMEOUT}.`,
            }),
          ),
      }),
    );
  const result = yield* command;
  if (result.code !== 0) {
    return yield* new OpenCodeRuntime.OpenCodeRuntimeError({
      operation: "models",
      detail: `OpenCode's model list exited with code ${result.code}.`,
    });
  }
  return parseOpenCodeModelList(result.stdout);
});

function displayNameForModelId(id: string): string {
  return id
    .split(/[-_/]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

const stripJsonComments = (source: string): string => {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        result += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      result += char;
    }
  }
  return result;
};

export const parseConfiguredProviderNames = (source: string): Map<string, string> => {
  const names = new Map<string, string>();
  try {
    const config = JSON.parse(stripJsonComments(source)) as {
      readonly providers?: Record<string, { readonly name?: unknown }>;
      readonly provider?: Record<string, { readonly name?: unknown }>;
    };
    const providers = config.providers ?? config.provider ?? {};
    for (const [id, provider] of Object.entries(providers)) {
      if (typeof provider?.name === "string" && provider.name.trim().length > 0) {
        names.set(id, provider.name.trim());
      }
    }
  } catch {
    // Config files can contain OpenCode-specific syntax; names are decoration only.
  }
  return names;
};

export const configuredProviderNamePaths = (
  environment: NodeJS.ProcessEnv,
  path: Path.Path,
): ReadonlyArray<string> => {
  const directory =
    environment.OPENCODE_CONFIG_DIR ??
    path.join(
      environment.XDG_CONFIG_HOME ??
        path.join(environment.HOME ?? environment.USERPROFILE ?? "", ".config"),
      "opencode",
    );
  const candidates = ["opencode.json", "opencode.jsonc"].map((file) => path.join(directory, file));
  return environment.OPENCODE_CONFIG ? [environment.OPENCODE_CONFIG, ...candidates] : candidates;
};

/**
 * The CLI applies the instance's config policies and provider definitions; the server API may
 * list more (or fewer) models and calls the Go gateway `opencode`. Keep only CLI-listed slugs.
 */
export const reconcileOpenCode2Catalog = (input: {
  readonly cliModels: ReadonlyArray<OpenCodeModelSlug>;
  readonly serverModels: ReadonlyArray<OpenCode2Model>;
  readonly providerNames?: ReadonlyMap<string, string>;
}): ReadonlyArray<OpenCode2Model> => {
  const bySlug = new Map(
    input.serverModels.map((model) => [`${model.providerID}/${model.id}`, model] as const),
  );
  return input.cliModels.map((slug) => {
    const gatewayName = GATEWAY_PROVIDER_NAMES.get(slug.providerID);
    const exact = bySlug.get(`${slug.providerID}/${slug.id}`);
    if (exact) {
      return gatewayName ? { ...exact, providerName: gatewayName } : exact;
    }

    const providerName = gatewayName ?? input.providerNames?.get(slug.providerID);
    const alias = GATEWAY_ALIASES.get(slug.providerID);
    const aliased = alias === undefined ? undefined : bySlug.get(`${alias}/${slug.id}`);
    if (aliased) {
      return {
        ...aliased,
        providerID: slug.providerID,
        ...(providerName
          ? { providerName }
          : aliased.providerName
            ? { providerName: aliased.providerName }
            : {}),
      };
    }

    return {
      providerID: slug.providerID,
      id: slug.id,
      name: displayNameForModelId(slug.id),
      ...(providerName ? { providerName } : {}),
      variants: [],
      deprecated: false,
    };
  });
};
