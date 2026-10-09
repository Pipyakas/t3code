import { expect, it } from "@effect/vitest";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopClerk from "./DesktopClerk.ts";

it.effect.each([true, false])(
  "keeps native single-instance handling without Clerk (primary=%s)",
  (primary) => {
    const events: string[] = [];
    const dependencies = Layer.mergeAll(
      NodePath.layerPosix,
      FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
      DesktopEnvironment.layer({
        dirname: "/repo/apps/desktop/dist-electron",
        homeDirectory: "/test",
        platform: "win32",
        processArch: "x64",
        appVersion: "1.2.3",
        appPath: "/repo/apps/desktop",
        isPackaged: false,
        resourcesPath: "/repo/resources",
        runningUnderArm64Translation: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            NodePath.layerPosix,
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { APPDATA: "/test" } })),
          ),
        ),
      ),
      Layer.mock(ElectronApp.ElectronApp)({
        setPath: (name, value) =>
          Effect.sync(() => {
            events.push(`${name}:${value}`);
          }),
        requestSingleInstanceLock: Effect.sync(() => {
          events.push("lock");
          return primary;
        }),
        quit: Effect.sync(() => {
          events.push("quit");
        }),
        on: (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
      }),
      Layer.mock(ElectronWindow.ElectronWindow)({}),
    );
    return Effect.gen(function* () {
      const lifecycle = yield* DesktopClerk.DesktopClerk;
      const exit = yield* lifecycle.configure.pipe(Effect.exit);
      expect(Exit.isSuccess(exit)).toBe(primary);
      expect(events).toEqual(
        primary
          ? ["userData:/test/t3code-v2", "lock", "second-instance"]
          : ["userData:/test/t3code-v2", "lock", "quit"],
      );
      expect(DesktopClerk.desktopClerkFrontendApiHostname).toBeUndefined();
    }).pipe(
      Effect.provide(DesktopClerk.layer.pipe(Layer.provideMerge(dependencies))),
      Effect.scoped,
    );
  },
);
