import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Effect, Layer, Queue, Ref, Stream, Option, Result } from "effect";

import {
  EventId,
  type ProviderRuntimeEvent,
  type ThreadId,
  TurnId,
  type ProviderSession,
  RuntimeTurnState,
} from "@t3tools/contracts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterRequestError, ProviderAdapterSessionNotFoundError, ProviderAdapterValidationError } from "../Errors.ts";
import { GeminiAdapter, type GeminiAdapterShape } from "../Services/GeminiAdapter.ts";

const PROVIDER = "gemini" as const;
const DEFAULT_GEMINI_BINARIES = ["gemini", "gemini-cli"] as const;

interface ACPSessionInfo {
  id: string;
  mode: string;
  status: string;
  activeTurnId?: TurnId;
}

const GEMINI_ACP_REQUEST_TIMEOUT_MS = 30_000;
const GEMINI_TURN_TIMEOUT_MS = 300_000;

export const makeGeminiAdapterLive = () =>
  Layer.effect(
    GeminiAdapter,
    Effect.gen(function* () {
      const settingsService = yield* ServerSettingsService;
      const sessionsRef = yield* Ref.make<Map<ThreadId, ACPSessionInfo>>(new Map());
      const sessionsIndex = new Map<ThreadId, ACPSessionInfo>();
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

      let geminiProcess: ChildProcessWithoutNullStreams | null = null;
      let isInitialized = false;
      let requestId = 0;
      const pendingRequests = new Map<
        string,
        { resolve: (v: unknown) => void; reject: (e: unknown) => void }
      >();

      const findThreadIdBySessionId = (sessionId: string): ThreadId | null => {
        for (const [threadId, session] of sessionsIndex) {
          if (session.id === sessionId) return threadId;
        }
        return null;
      };

      const sendACPRequest = (
        method: string,
        params?: Record<string, unknown>,
        timeoutMs = GEMINI_ACP_REQUEST_TIMEOUT_MS,
      ): Promise<unknown> => {
        return new Promise((resolve, reject) => {
          const id = String(++requestId);
          const timeoutHandle = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`${method} timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          pendingRequests.set(id, {
            resolve: (value) => {
              clearTimeout(timeoutHandle);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timeoutHandle);
              reject(error);
            },
          });

          if (geminiProcess?.stdin) {
            geminiProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
          } else {
            pendingRequests.delete(id);
            clearTimeout(timeoutHandle);
            reject(new Error("Gemini not connected"));
          }
        });
      };

      const handleUpdate = (params: unknown) => {
        const payload = params as {
          sessionId?: string;
          update?: {
            sessionUpdate?: string;
            content?: { type?: string; text?: string };
          };
        };
        const sessionId = payload.sessionId;
        const update = payload.update;
        if (!sessionId || !update) return;

        const threadId = findThreadIdBySessionId(sessionId);
        if (!threadId) return;

        const session = sessionsIndex.get(threadId);
        const turnId = session?.activeTurnId;
        if (!turnId) return;

        const text = update.content?.type === "text" ? update.content.text : undefined;
        if (!text || text.length === 0) return;

        if (update.sessionUpdate === "agent_message_chunk") {
          Effect.runPromise(Queue.offer(runtimeEventQueue, {
            type: "content.delta",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider: PROVIDER,
            createdAt: new Date().toISOString(),
            threadId,
            turnId,
            payload: { delta: text, streamKind: "assistant_text" },
          })).catch(() => {});
        } else if (update.sessionUpdate === "agent_thought_chunk") {
          Effect.runPromise(Queue.offer(runtimeEventQueue, {
            type: "content.delta",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider: PROVIDER,
            createdAt: new Date().toISOString(),
            threadId,
            turnId,
            payload: { delta: text, streamKind: "reasoning_text" },
          })).catch(() => {});
        }
      };

      const ensureProcess = Effect.gen(function* () {
        if (geminiProcess || isInitialized) return;

        const settings = yield* settingsService.getSettings;
        const configured = settings.providers.gemini.binaryPath?.trim();
        const candidates = configured ? [configured] : [...DEFAULT_GEMINI_BINARIES];

        let child: ChildProcessWithoutNullStreams | null = null;
        let lastError: Error | null = null;

        for (const candidate of candidates) {
          try {
            child = spawn(candidate, ["--acp"], {
              stdio: ["pipe", "pipe", "pipe"],
              shell: process.platform === "win32",
            });
            break;
          } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
          }
        }

        if (!child) {
          throw lastError ?? new Error("Could not spawn Gemini CLI process");
        }

        geminiProcess = child;

        child.on("exit", () => {
          geminiProcess = null;
          isInitialized = false;
        });

        const decoder = new TextDecoder();
        const reader = (child.stdout as any).on("data", (data: Uint8Array) => {
          const lines = decoder.decode(data).split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id && pendingRequests.has(String(msg.id))) {
                const pending = pendingRequests.get(String(msg.id))!;
                if (msg.error) pending.reject(msg.error);
                else pending.resolve(msg.result);
                pendingRequests.delete(String(msg.id));
              } else if (msg.method === "session/update") {
                handleUpdate(msg.params);
              }
            } catch {
              // Ignore non-JSON output
            }
          }
        });

        yield* Effect.tryPromise({
          try: () => sendACPRequest("initialize", {
            protocolVersion: 1,
            capabilities: { tools: true, terminals: true, filesystem: true, permissions: true },
            clientInfo: { name: "t3code", version: "0.1.0" },
          }),
          catch: (e) => new Error(`ACP initialization failed: ${e instanceof Error ? e.message : String(e)}`),
        });
        isInitialized = true;
      });

      const startSession: GeminiAdapterShape["startSession"] = (input) =>
        Effect.gen(function* () {
          yield* ensureProcess;
          const sessionResult = (yield* Effect.tryPromise({
            try: () => sendACPRequest("session/new", {
              mode: input.runtimeMode === "full-access" ? "fullAccess" : "approvalRequired",
              cwd: input.cwd ?? process.cwd(),
              mcpServers: [],
            }),
            catch: (e) => new Error(`session/new failed: ${e instanceof Error ? e.message : String(e)}`),
          })) as { sessionId: string };

          const sessionInfo: ACPSessionInfo = {
            id: sessionResult.sessionId,
            mode: input.runtimeMode,
            status: "ready",
          };

          yield* Ref.update(sessionsRef, (s) => new Map(s).set(input.threadId, sessionInfo));
          sessionsIndex.set(input.threadId, sessionInfo);

          return {
            provider: PROVIDER,
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            status: "ready",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });

      const sendTurn: GeminiAdapterShape["sendTurn"] = (input) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          const sessionInfo = sessions.get(input.threadId);
          if (!sessionInfo) {
            throw new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId: input.threadId, cause: undefined });
          }

          const turnId = TurnId.makeUnsafe(randomUUID());
          yield* Ref.update(sessionsRef, (s) => {
            const next = new Map(s);
            const existing = next.get(input.threadId);
            if (existing) {
              const updated = { ...existing, activeTurnId: turnId };
              next.set(input.threadId, updated);
              sessionsIndex.set(input.threadId, updated);
            }
            return next;
          });

          yield* Queue.offer(runtimeEventQueue, {
            type: "turn.started",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            createdAt: new Date().toISOString(),
            payload: {},
          });

          const params: Record<string, any> = {
            sessionId: sessionInfo.id,
            prompt: [{ type: "text", text: input.input ?? "" }],
          };
          if (input.modelSelection?.provider === PROVIDER) {
            params.model = input.modelSelection.model;
          }

          const promptExit = yield* Effect.exit(Effect.tryPromise({
            try: () => sendACPRequest("session/prompt", params, GEMINI_TURN_TIMEOUT_MS),
            catch: (e) => new Error(`session/prompt failed: ${e instanceof Error ? e.message : String(e)}`),
          }));

          yield* Ref.update(sessionsRef, (s) => {
            const next = new Map(s);
            const existing = next.get(input.threadId);
            if (existing) {
              const { activeTurnId: _, ...rest } = existing;
              next.set(input.threadId, rest);
              sessionsIndex.set(input.threadId, rest);
            }
            return next;
          });

          if (promptExit._tag === "Failure") {
            const message = promptExit.cause instanceof Error ? promptExit.cause.message : String(promptExit.cause);
            yield* Queue.offer(runtimeEventQueue, {
              type: "turn.completed",
              eventId: EventId.makeUnsafe(randomUUID()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              createdAt: new Date().toISOString(),
              payload: { state: "failed" as RuntimeTurnState, errorMessage: message },
            });
            throw promptExit.cause;
          }

          yield* Queue.offer(runtimeEventQueue, {
            type: "turn.completed",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            createdAt: new Date().toISOString(),
            payload: { state: "completed" as RuntimeTurnState },
          });

          return { threadId: input.threadId, turnId };
        });

      return {
        provider: PROVIDER,
        capabilities: { sessionModelSwitch: "restart-session" },
        startSession,
        sendTurn,
        interruptTurn: (threadId) =>
          Effect.gen(function* () {
            const sessions = yield* Ref.get(sessionsRef);
            const info = sessions.get(threadId);
            if (info) {
              yield* Effect.tryPromise({
                try: () => sendACPRequest("session/cancel", { sessionId: info.id }),
                catch: () => {},
              });
            }
          }),
        respondToRequest: () => Effect.void,
        respondToUserInput: () => Effect.void,
        stopSession: (threadId) =>
          Effect.gen(function* () {
            const sessions = yield* Ref.get(sessionsRef);
            const info = sessions.get(threadId);
            if (info) {
              yield* Effect.tryPromise({
                try: () => sendACPRequest("session/end", { sessionId: info.id }),
                catch: () => {},
              });
            }
            yield* Ref.update(sessionsRef, (s) => {
              const next = new Map(s);
              next.delete(threadId);
              return next;
            });
            sessionsIndex.delete(threadId);
          }),
        listSessions: () =>
          Ref.get(sessionsRef).pipe(
            Effect.map((sessions) => {
              const now = new Date().toISOString();
              return Array.from(sessions.entries()).map(([threadId, info]) => ({
                provider: PROVIDER,
                threadId,
                runtimeMode: info.mode as any,
                status: "ready" as const,
                createdAt: now,
                updatedAt: now,
              }));
            }),
          ),
        hasSession: (threadId) => Ref.get(sessionsRef).pipe(Effect.map((s) => s.has(threadId))),
        readThread: () => Effect.fail(new ProviderAdapterRequestError({ provider: PROVIDER, method: "readThread", detail: "Not implemented" })),
        rollbackThread: () => Effect.fail(new ProviderAdapterRequestError({ provider: PROVIDER, method: "rollbackThread", detail: "Not implemented" })),
        stopAll: () =>
          Effect.gen(function* () {
            if (geminiProcess) {
              geminiProcess.kill();
              geminiProcess = null;
            }
            yield* Ref.set(sessionsRef, new Map());
            sessionsIndex.clear();
            isInitialized = false;
          }),
        streamEvents: Stream.fromQueue(runtimeEventQueue),
      } satisfies GeminiAdapterShape;
    }),
  );

export const GeminiAdapterLive = makeGeminiAdapterLive();
