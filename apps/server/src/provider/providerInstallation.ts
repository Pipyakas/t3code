import {
  ProviderSetupError,
  type ProviderSetupInput,
  type ProviderInstallCancelInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

/** Managed installers only served removed harnesses; keep the RPC shape but reject every action. */
export const makeProviderInstallation = () =>
  Effect.succeed({
    start: (input: ProviderSetupInput) =>
      Effect.fail(
        new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "install",
          detail:
            "Managed harness installation has been removed. Install Claude, OpenCode, or an ACP agent separately.",
        }),
      ),
    cancel: (input: ProviderInstallCancelInput) =>
      Effect.fail(
        new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "cancel-install",
          detail: "Managed harness installation has been removed.",
        }),
      ),
    subscribe: (input: ProviderSetupInput) =>
      Stream.fail(
        new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "observe-install",
          detail: "Managed harness installation has been removed.",
        }),
      ),
    remove: (input: ProviderSetupInput) =>
      Effect.fail(
        new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "remove-install",
          detail: "Managed harness installation has been removed.",
        }),
      ),
  });
