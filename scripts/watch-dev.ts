#!/usr/bin/env node

import { spawn, ChildProcess } from "node:child_process";
import { watch } from "fs";

const BUILD_CMD = "bun run build";
const SERVER_CMD = "node apps/server/dist/bin.mjs dev";
const WEB_CMD = "node_modules/.bin/turbo run dev --filter=@t3tools/web";

let serverProcess: ChildProcess | null = null;
let webProcess: ChildProcess | null = null;

function startServer() {
  console.log("[watch] Starting server...");
  serverProcess = spawn(SERVER_CMD, [], { shell: true, detached: true, stdio: "ignore" });
  serverProcess.unref();
}

function startWeb() {
  console.log("[watch] Starting web dev...");
  webProcess = spawn(WEB_CMD, [], { shell: true, stdio: "inherit" });
}

async function rebuild() {
  console.log("[watch] Rebuilding...");
  const build = spawn(BUILD_CMD, [], { shell: true, stdio: "inherit" });

  await new Promise<void>((resolve) => {
    build.on("close", (code) => {
      if (code === 0) {
        console.log("[watch] Build complete, restarting server...");
        if (serverProcess) {
          serverProcess.kill();
        }
        startServer();
      }
      resolve();
    });
  });
}

console.log("[watch] Starting watch mode...");
startServer();
startWeb();

const srcDir = "apps/server/src";
const watcher = watch(srcDir, { recursive: true }, (eventType, filename) => {
  if (filename && (filename.endsWith(".ts") || filename.endsWith(".tsx"))) {
    console.log(`[watch] File changed: ${filename}`);
    rebuild();
  }
});

process.on("SIGINT", () => {
  console.log("[watch] Shutting down...");
  if (serverProcess) serverProcess.kill();
  if (webProcess) webProcess.kill();
  watcher.close();
  process.exit(0);
});
