// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
// Windows has no signal a service manager can send to ask the launcher to stop:
// ending a scheduled task terminates the process outright. The launcher listens
// on a per-home named pipe instead, and `t3 service` asks it to stop there
// before falling back to ending the task. Node built-ins only, because the
// launcher imports this.
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

const STOP_REQUEST = "stop\n";

/** One pipe per T3 home, so two homes on one machine never stop each other. */
export function serviceControlPipePath(baseDir: string): string {
  const key = NodeCrypto.createHash("sha256")
    .update(NodePath.resolve(baseDir).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return `\\\\.\\pipe\\t3code-service-${key}`;
}

/**
 * Serves stop requests until closed. A request is the client writing
 * `stop\n`; the default pipe ACL only grants write access to the owner, so
 * other local users can connect but cannot stop the service. The connection
 * stays open until the launcher exits, which is how the client learns the
 * stop finished.
 */
export function listenForServiceControl(
  baseDir: string,
  onStop: () => Promise<void>,
): Promise<{ readonly close: () => void }> {
  const sockets = new Set<NodeNet.Socket>();
  const server = NodeNet.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let received = "";
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      received += chunk;
      if (received === STOP_REQUEST) void onStop();
      else if (!STOP_REQUEST.startsWith(received)) socket.destroy();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(serviceControlPipePath(baseDir), () => {
      server.removeListener("error", reject);
      resolve({
        // Open requests are waiting for this process to exit; end them so
        // they do not hold the event loop open.
        close: () => {
          server.close();
          for (const socket of sockets) socket.destroy();
        },
      });
    });
  });
}

/**
 * Asks the launcher serving `baseDir` to stop and waits until it has exited.
 * Resolves "not-running" when nothing listens on the pipe.
 */
export function requestServiceStop(
  baseDir: string,
  timeoutMs: number,
): Promise<"stopped" | "not-running"> {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.connect(serviceControlPipePath(baseDir));
    let connected = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("The service did not stop in time."));
    }, timeoutMs);
    socket.on("connect", () => {
      connected = true;
      socket.write(STOP_REQUEST);
    });
    socket.on("data", () => undefined);
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (connected) return;
      clearTimeout(timer);
      if (error.code === "ENOENT") resolve("not-running");
      else reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (connected) resolve("stopped");
    });
  });
}
