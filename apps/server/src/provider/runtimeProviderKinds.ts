import type { ProviderKind } from "@t3tools/contracts";

export const RUNTIME_PROVIDER_KINDS = [
  "codex",
  "claudeAgent",
  "gemini",
  "opencode",
] as const satisfies ReadonlyArray<ProviderKind>;
