import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

/**
 * Runtime offline flag. `T3CODE_OFFLINE=1` on the server's environment turns
 * this machine offline: product telemetry is not recorded or sent, T3 Connect
 * hosting is refused (sign-in and connecting to other environments still
 * work), and Tailscale is never run or offered. The flag defaults to false, so
 * a machine without it behaves exactly like upstream.
 *
 * Read through the ambient ConfigProvider (process.env by default); tests
 * override it with
 * `ConfigProvider.layer(ConfigProvider.fromUnknown({ T3CODE_OFFLINE: "1" }))`.
 */
export const offlineModeConfig = Config.Boolean("T3CODE_OFFLINE").pipe(Config.withDefault(false));

/**
 * Same flag as {@link offlineModeConfig}, with the error channel erased: a
 * malformed value reads as online instead of failing the caller. Use this at
 * `yield*` sites whose Effect types must not grow a `ConfigError`.
 */
export const offlineMode: Effect.Effect<boolean> = offlineModeConfig.pipe(
  Effect.orElseSucceed(() => false),
);
