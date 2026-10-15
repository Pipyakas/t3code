import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";

import { main as runServiceLauncher } from "../serviceLauncher.ts";

/**
 * Hosts the service launcher inside the CLI executable. The service manager
 * runs `t3 __service-launcher` and the launcher spawns the server from the
 * same executable, so the machine needs no Node to run either.
 *
 * The launcher owns SIGTERM handling and the process lifetime: it must finish
 * stopping its child before the process exits, so it runs detached from the
 * CLI's fiber rather than under `runMain`, whose signal handler would
 * interrupt the fiber and exit while the child is still being terminated.
 *
 * systemd and launchd pass the home in `T3CODE_HOME` and capture output
 * themselves; a Windows scheduled task can do neither, so it passes both as
 * flags.
 */
export const serviceLauncherCommand = Command.make("__service-launcher", {
  t3Home: Flag.String("t3-home").pipe(Flag.optional),
  logFile: Flag.String("log-file").pipe(Flag.optional),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ t3Home, logFile }) =>
    Effect.sync(() => {
      runServiceLauncher({
        baseDir: Option.getOrUndefined(t3Home),
        logFile: Option.getOrUndefined(logFile),
      }).catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        process.stderr.write(`[service-launcher] ${error.message}\n`);
        process.exitCode = 1;
      });
    }),
  ),
);
