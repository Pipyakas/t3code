import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopUserData from "./DesktopUserData.ts";

// Preserve the lifecycle service name without loading a hosted authentication SDK.
export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
  }
>()("@t3tools/desktop/app/DesktopClerk") {}

export const desktopClerkFrontendApiHostname: string | undefined = undefined;

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const app = yield* ElectronApp.ElectronApp;
  const userDataPath = yield* DesktopUserData.resolveUserDataPath(environment);
  yield* app.setPath("userData", userDataPath);
  const primary = yield* app.requestSingleInstanceLock;
  return DesktopClerk.of({
    configure: Effect.gen(function* () {
      if (!primary) {
        yield* app.quit;
        return yield* Effect.interrupt;
      }
      const window = yield* ElectronWindow.ElectronWindow;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const run = Effect.runPromiseWith(context);
      yield* app.on("second-instance", () => {
        void run(
          Effect.gen(function* () {
            const current = yield* window.currentMainOrFirst;
            if (Option.isSome(current)) yield* window.reveal(current.value);
          }),
        );
      });
    }),
  });
});
export const layer = Layer.effect(DesktopClerk, make);
