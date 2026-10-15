import { offlineFromServerConfig } from "~/cloud/publicConfig";
import { usePrimaryEnvironment } from "~/state/environments";

/**
 * True when the primary environment's server runs in offline mode
 * (`T3CODE_OFFLINE=1`): hosting and Tailscale entry points stay hidden. A
 * server that does not send the flag (older, or online) reads as online.
 */
export function useOfflineMode(): boolean {
  return offlineFromServerConfig(usePrimaryEnvironment()?.serverConfig ?? null);
}
