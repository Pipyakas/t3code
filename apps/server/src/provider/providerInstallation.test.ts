import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { makeProviderInstallation } from "./providerInstallation.ts";

it.effect("rejects managed installation without creating an installer", () =>
  Effect.gen(function* () {
    const installation = yield* makeProviderInstallation();
    for (const id of ["codex", "antigravity", "claudeAgent", "opencode"]) {
      const input = { instanceId: ProviderInstanceId.make(id) };
      const error = yield* installation.start(input).pipe(Effect.flip);
      expect(error.detail).toContain("has been removed");
      const removal = yield* installation.remove(input).pipe(Effect.flip);
      expect(removal.detail).toContain("has been removed");
    }
  }),
);
