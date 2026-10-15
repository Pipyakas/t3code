import { main as runServiceLauncher } from "../serviceLauncher.ts";

/**
 * systemd and launchd pass the home in `T3CODE_HOME` and capture output
 * themselves; a Windows scheduled task can do neither, so it passes both as
 * `--t3-home` and `--log-file`.
 */
export async function runServiceLauncherCli(
  options: { readonly baseDir?: string | undefined; readonly logFile?: string | undefined } = {},
): Promise<void> {
  try {
    await runServiceLauncher(options);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[service-launcher] ${message}\n`);
    process.exitCode = 1;
  }
}
