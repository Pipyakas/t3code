import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@t3tools/provider-core/client";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { fxClient } from "@t3tools/provider-fx/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";

/**
 * The provider client definitions this web build ships, in presentation order.
 * This is the order the settings providers panel and the add-provider dialog
 * list drivers in; it should lead with the harnesses this build enables by
 * default, matching `BUILT_IN_DRIVERS` on the server.
 */
export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    acpRegistryAgentIds: ["claude-acp"],
    settingsSchema: ClaudeSettings,
  },
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    acpRegistryAgentIds: ["codex-acp"],
    settingsSchema: CodexSettings,
  },
  cursorClient,
  grokClient,
  fxClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    acpRegistryAgentIds: ["antigravity-acp"],
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
