import { BACKGROUND_SERVICE_DESKTOP_SECRET_NAME } from "@t3tools/shared/desktopBootstrapToken";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** A background service (`t3 service`) serving the desktop's own state. */
export interface BackgroundService {
  readonly httpBaseUrl: URL;
  readonly secret: string;
  readonly runtimeStatePath: string;
}

// The fields of the server's `server-runtime.json` this needs; the server owns
// the full schema.
const ServerRuntimeState = Schema.fromJsonString(
  Schema.Struct({
    pid: Schema.Int,
    origin: Schema.String,
    serviceManaged: Schema.optional(Schema.Boolean),
  }),
);
const decodeServerRuntimeState = Schema.decodeUnknownOption(ServerRuntimeState);

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Finds a running background service for `stateDir`. The service records
 * itself in `server-runtime.json` and keeps the secret this desktop
 * authenticates with in its secret store; both are readable only by the
 * account that owns the state.
 */
export const discover = Effect.fn("desktop.backgroundService.discover")(function* (
  stateDir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeStatePath = path.join(stateDir, "server-runtime.json");
  const runtime = yield* fileSystem
    .readFileString(runtimeStatePath)
    .pipe(Effect.map(decodeServerRuntimeState), Effect.orElseSucceed(Option.none));
  if (
    Option.isNone(runtime) ||
    runtime.value.serviceManaged !== true ||
    !isProcessAlive(runtime.value.pid) ||
    !URL.canParse(runtime.value.origin)
  ) {
    return Option.none<BackgroundService>();
  }
  const secret = yield* fileSystem
    .readFile(path.join(stateDir, "secrets", `${BACKGROUND_SERVICE_DESKTOP_SECRET_NAME}.bin`))
    .pipe(Effect.option);
  if (Option.isNone(secret)) return Option.none<BackgroundService>();
  return Option.some<BackgroundService>({
    httpBaseUrl: new URL(runtime.value.origin),
    secret: Hex.encode(secret.value),
    runtimeStatePath,
  });
});
