#!/usr/bin/env node
import { spawn } from "node:child_process";

const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(` exited with code ${code}`)),
    );
    child.on("error", reject);
  });

async function main() {
  console.log("Building t3code...");
  await run("bun", ["run", "build"]);

  console.log("Restarting t3code.service...");
  await run("systemctl", ["--user", "restart", "t3code.service"]);

  console.log("Checking status...");
  await run("systemctl", ["--user", "status", "t3code.service", "--no-pager", "--lines=10"]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
