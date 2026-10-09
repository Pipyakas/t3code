import { RelayClientInstallFailedError, type RelayClientStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/** Retain old RPC compatibility without probing, downloading, or starting a tunnel client. */
export const relayClientStatus = Effect.succeed<RelayClientStatus>({
  status: "missing",
  version: "removed",
});
export const installRelayClient = Stream.fail(
  new RelayClientInstallFailedError({
    reason: "removed",
    message: "T3 Connect is removed in this build. Use a direct connection instead.",
  }),
);
