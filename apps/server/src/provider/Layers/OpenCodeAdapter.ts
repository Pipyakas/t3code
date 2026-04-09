/**
 * OpenCodeAdapterLive - ACP (Agent Client Protocol) implementation for OpenCode provider.
 *
 * This is a simplified implementation that communicates with OpenCode over ACP.
 * Full ACP implementation matching Codex functionality.
 *
 * @module OpenCodeAdapterLive
 */
import {
  type ProviderRuntimeEvent,
  type ProviderSession,
  type RuntimeContentStreamKind,
  ThreadId,
  TurnId,
  EventId,
  RuntimeTurnState,
} from "@t3tools/contracts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Effect, Layer, Queue, Ref, Stream } from "effect";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { OpenCodeAdapter, type OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";

const PROVIDER = "opencode" as const;

interface ACPSessionInfo {
  id: string;
  mode: string;
  status: string;
  activeTurnId?: TurnId;
}

export interface OpenCodeAdapterLiveOptions {
  readonly binaryPath?: string;
}

const makeEventId = (): EventId => EventId.makeUnsafe(crypto.randomUUID());
const OPENCODE_DEBUG_ENABLED = process.env.T3_OPENCODE_DEBUG !== "0";
const OPENCODE_ACP_REQUEST_TIMEOUT_MS = 30_000;
const OPENCODE_TURN_TIMEOUT_MS = 180_000;

const debugLog = (message: string, details?: Record<string, unknown>): void => {
  if (!OPENCODE_DEBUG_ENABLED) return;
  if (details) {
    console.log(`[OpenCodeAdapter] ${message}`, details);
    return;
  }
  console.log(`[OpenCodeAdapter] ${message}`);
};

const runDetached = (effect: Effect.Effect<unknown, never, never>): void => {
  void Effect.runPromise(effect).catch((error) => {
    debugLog("detached effect failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

const toRequestError = (
  threadId: ThreadId,
  method: string,
  cause: unknown,
): ProviderAdapterError => {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: cause instanceof Error ? cause.message : `${method} failed`,
    cause,
  });
};

const makeOpenCodeAdapter = Effect.gen(function* () {
  const sessionsRef = yield* Ref.make<Map<ThreadId, ACPSessionInfo>>(new Map());
  const sessionsIndex = new Map<ThreadId, ACPSessionInfo>();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

  let opencodeProcess: ChildProcessWithoutNullStreams | null = null;
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
    timeoutMs = OPENCODE_ACP_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const id = String(++requestId);
      const timeoutHandle: ReturnType<typeof setTimeout> = setTimeout(() => {
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

      if (opencodeProcess?.stdin) {
        opencodeProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      } else {
        pendingRequests.delete(id);
        clearTimeout(timeoutHandle);
        reject(new Error("OpenCode not connected"));
      }
    });
  };

  const emitContentDelta = (content: string, threadId: ThreadId, turnId: TurnId) => {
    return Queue.offer(runtimeEventQueue, {
      type: "content.delta",
      eventId: makeEventId(),
      provider: PROVIDER,
      createdAt: new Date().toISOString(),
      threadId,
      turnId,
      payload: {
        delta: content,
        streamKind: "assistant_text" as RuntimeContentStreamKind,
      },
      providerRefs: {},
      raw: { source: "opencode.acp", method: "content.delta", payload: { content } },
    });
  };

  const spawnOpenCode = Effect.gen(function* () {
    if (opencodeProcess || isInitialized) return;

    opencodeProcess = spawn("opencode", ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    debugLog("spawned opencode acp process");

    const decoder = new TextDecoder();
    const stdout = ReadableStream.fromWeb(
      opencodeProcess.stdout as unknown as ReadableStream<Uint8Array>,
    );

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
      if (!sessionId || !update) {
        debugLog("ignoring update without session/update payload", { payload });
        return;
      }

      const threadId = findThreadIdBySessionId(sessionId);
      if (!threadId) {
        debugLog("ignoring update: unknown session id", {
          sessionId,
          sessionUpdate: update.sessionUpdate,
        });
        return;
      }

      const session = sessionsIndex.get(threadId);
      const turnId = session?.activeTurnId;
      if (!turnId) {
        debugLog("ignoring update: no active turn id", {
          threadId,
          sessionId,
          sessionUpdate: update.sessionUpdate,
        });
        return;
      }

      const text = update.content?.type === "text" ? update.content.text : undefined;
      if (!text || text.length === 0) {
        debugLog("ignoring update: empty non-text content", {
          threadId,
          sessionId,
          sessionUpdate: update.sessionUpdate,
          contentType: update.content?.type,
        });
        return;
      }

      debugLog("received update chunk", {
        threadId,
        sessionId,
        turnId,
        sessionUpdate: update.sessionUpdate,
        textLength: text.length,
      });

      if (update.sessionUpdate === "agent_message_chunk") {
        debugLog("emitting assistant_text delta", { threadId, turnId, textLength: text.length });
        runDetached(emitContentDelta(text, threadId, turnId));
        return;
      }

      if (update.sessionUpdate === "agent_thought_chunk") {
        debugLog("emitting reasoning_text delta", { threadId, turnId, textLength: text.length });
        runDetached(
          Queue.offer(runtimeEventQueue, {
            type: "content.delta",
            eventId: makeEventId(),
            provider: PROVIDER,
            createdAt: new Date().toISOString(),
            threadId,
            turnId,
            payload: {
              delta: text,
              streamKind: "reasoning_text" as RuntimeContentStreamKind,
            },
            providerRefs: {},
            raw: {
              source: "opencode.acp",
              method: "session/update",
              payload: { sessionId, update },
            },
          }),
        );
      }

      debugLog("ignoring unhandled session/update kind", {
        threadId,
        sessionId,
        turnId,
        sessionUpdate: update.sessionUpdate,
      });
    };

    const startReadLoop = async (): Promise<void> => {
      const reader = stdout.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let msg: {
              id?: string;
              method?: string;
              params?: unknown;
              error?: unknown;
              result?: unknown;
            };
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }

            if (msg.id && pendingRequests.has(msg.id)) {
              const pending = pendingRequests.get(msg.id)!;
              if (msg.error) pending.reject(msg.error);
              else pending.resolve(msg.result);
              pendingRequests.delete(msg.id);
              continue;
            }

            if (msg.method === "session/update") {
              handleUpdate(msg.params);
            }
          }
        }
      } catch {
        debugLog("stdout read loop exited with error");
      }
    };

    void startReadLoop();

    yield* Effect.sleep(100);

    yield* Effect.tryPromise({
      try: () =>
        sendACPRequest("initialize", {
          protocolVersion: 1,
          capabilities: { tools: true, terminals: true, filesystem: true, permissions: true },
          clientInfo: { name: "t3code", version: "0.1.0" },
        }),
      catch: (e) => toRequestError(ThreadId.makeUnsafe("spawn"), "initialize", e),
    });
    isInitialized = true;
    debugLog("initialize completed");
  });

  const startSession: OpenCodeAdapterShape["startSession"] = (input) => {
    return Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }

      yield* spawnOpenCode;

      const threadId = input.threadId;
      const now = new Date().toISOString();

      let sessionId = "";
      const sessionResult = yield* Effect.tryPromise({
        try: () =>
          sendACPRequest("session/new", {
            mode: input.runtimeMode === "full-access" ? "fullAccess" : "approvalRequired",
            cwd: process.cwd(),
            mcpServers: [],
          }) as Promise<{ sessionId: string }>,
        catch: (e) => toRequestError(threadId, "session/new", e),
      });
      sessionId = sessionResult.sessionId;

      const sessionInfo: ACPSessionInfo = {
        id: sessionId,
        mode: input.runtimeMode === "full-access" ? "fullAccess" : "approvalRequired",
        status: "running",
      };

      yield* Ref.update(sessionsRef, (sessions) => {
        const newSessions = new Map(sessions);
        newSessions.set(threadId, sessionInfo);
        return newSessions;
      });
      sessionsIndex.set(threadId, sessionInfo);
      debugLog("session started", {
        threadId,
        providerThreadId: sessionId,
        runtimeMode: input.runtimeMode,
      });

      yield* Queue.offer(runtimeEventQueue, {
        type: "thread.started",
        eventId: makeEventId(),
        provider: PROVIDER,
        createdAt: now,
        threadId,
        payload: { providerThreadId: sessionId },
        providerRefs: {},
        raw: { source: "opencode.acp", method: "session/new", payload: {} },
      });

      yield* Queue.offer(runtimeEventQueue, {
        type: "session.configured",
        eventId: makeEventId(),
        provider: PROVIDER,
        createdAt: now,
        threadId,
        payload: { config: {} },
        providerRefs: {},
        raw: { source: "opencode.acp", method: "session/configured", payload: {} },
      });

      return {
        threadId,
        provider: PROVIDER,
        status: "running",
        runtimeMode: input.runtimeMode,
        createdAt: now,
        updatedAt: now,
      };
    });
  };

  const sendTurn: OpenCodeAdapterShape["sendTurn"] = (input) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      const sessionInfo = sessions.get(input.threadId);

      if (!sessionInfo) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: input.threadId,
          cause: undefined,
        });
      }

      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      const now = new Date().toISOString();
      debugLog("turn started", { threadId: input.threadId, turnId });

      yield* Ref.update(sessionsRef, (sessions) => {
        const next = new Map(sessions);
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
        eventId: makeEventId(),
        provider: PROVIDER,
        createdAt: now,
        threadId: input.threadId,
        turnId,
        payload: {},
        providerRefs: {},
        raw: { source: "opencode.acp", method: "session/prompt", payload: {} },
      });

      const promptExit = yield* Effect.exit(
        Effect.tryPromise({
          try: () =>
            sendACPRequest(
              "session/prompt",
              {
                prompt: [{ type: "text", text: input.input }],
                sessionId: sessionInfo.id,
              },
              OPENCODE_TURN_TIMEOUT_MS,
            ) as Promise<{
              usage?: {
                inputTokens?: number;
                outputTokens?: number;
              };
            }>,
          catch: (e) => toRequestError(input.threadId, "session/prompt", e),
        }),
      );

      yield* Ref.update(sessionsRef, (sessions) => {
        const next = new Map(sessions);
        const existing = next.get(input.threadId);
        if (existing) {
          const { activeTurnId: _discarded, ...rest } = existing;
          next.set(input.threadId, rest);
          sessionsIndex.set(input.threadId, rest);
        }
        return next;
      });

      if (promptExit._tag === "Failure") {
        const promptError = toRequestError(input.threadId, "session/prompt", promptExit.cause);
        const errorMessage = promptError.message;
        debugLog("session/prompt failed", { threadId: input.threadId, turnId, errorMessage });
        yield* Queue.offer(runtimeEventQueue, {
          type: "turn.completed",
          eventId: makeEventId(),
          provider: PROVIDER,
          createdAt: now,
          threadId: input.threadId,
          turnId,
          providerRefs: {},
          payload: {
            state: "failed" as RuntimeTurnState,
            errorMessage,
          },
          raw: { source: "opencode.acp", method: "session/prompt", payload: { errorMessage } },
        });
        return yield* promptError;
      }

      const result = promptExit.value;
      debugLog("session/prompt completed", {
        threadId: input.threadId,
        turnId,
        inputTokens: result?.usage?.inputTokens ?? 0,
        outputTokens: result?.usage?.outputTokens ?? 0,
      });

      yield* Queue.offer(runtimeEventQueue, {
        type: "turn.completed",
        eventId: makeEventId(),
        provider: PROVIDER,
        createdAt: now,
        threadId: input.threadId,
        turnId,
        providerRefs: {},
        payload: {
          state: "completed" as RuntimeTurnState,
          usage: {
            inputTokens: result?.usage?.inputTokens ?? 0,
            outputTokens: result?.usage?.outputTokens ?? 0,
            reasoningTokens: 0,
          },
        },
        raw: { source: "opencode.acp", method: "session/complete", payload: {} },
      });
      debugLog("turn completed event emitted", { threadId: input.threadId, turnId });

      return { threadId: input.threadId, turnId };
    });
  };

  const interruptTurn: OpenCodeAdapterShape["interruptTurn"] = (threadId) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      const sessionInfo = sessions.get(threadId);

      if (!sessionInfo) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
          cause: undefined,
        });
      }

      yield* Effect.tryPromise({
        try: () => sendACPRequest("session/cancel", { sessionId: sessionInfo.id }),
        catch: (e) => toRequestError(threadId, "session/cancel", e),
      });
    });
  };

  const readThread: OpenCodeAdapterShape["readThread"] = (threadId) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      if (!sessions.has(threadId)) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
          cause: undefined,
        });
      }
      return { threadId, turns: [] };
    });
  };

  const rollbackThread: OpenCodeAdapterShape["rollbackThread"] = (threadId) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      if (!sessions.has(threadId)) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
          cause: undefined,
        });
      }
      return { threadId, turns: [] };
    });
  };

  const respondToRequest: OpenCodeAdapterShape["respondToRequest"] = (
    threadId,
    _requestId,
    _decision,
  ) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      if (!sessions.has(threadId)) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
          cause: undefined,
        });
      }
    });
  };

  const respondToUserInput: OpenCodeAdapterShape["respondToUserInput"] = (
    threadId,
    _requestId,
    _answers,
  ) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      if (!sessions.has(threadId)) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
          cause: undefined,
        });
      }
    });
  };

  const stopSession: OpenCodeAdapterShape["stopSession"] = (threadId) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      const sessionInfo = sessions.get(threadId);

      if (sessionInfo) {
        yield* Effect.tryPromise({
          try: () => sendACPRequest("session/end", { sessionId: sessionInfo.id }),
          catch: (e) => toRequestError(threadId, "session/end", e),
        });
      }

      yield* Ref.update(sessionsRef, (s) => {
        const newSessions = new Map(s);
        newSessions.delete(threadId);
        return newSessions;
      });
      sessionsIndex.delete(threadId);

      yield* Queue.offer(runtimeEventQueue, {
        type: "session.exited",
        eventId: makeEventId(),
        provider: PROVIDER,
        createdAt: new Date().toISOString(),
        threadId,
        payload: { reason: "user_stopped" },
        providerRefs: {},
        raw: { source: "opencode.acp", method: "session/end", payload: {} },
      });
    });
  };

  const listSessions: OpenCodeAdapterShape["listSessions"] = () => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      return Array.from(sessions.values()).map((info) => ({
        threadId: ThreadId.makeUnsafe(info.id),
        provider: PROVIDER,
        status: info.status as ProviderSession["status"],
        runtimeMode: "full-access" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    });
  };

  const hasSession: OpenCodeAdapterShape["hasSession"] = (threadId) => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      return sessions.has(threadId);
    });
  };

  const stopAll: OpenCodeAdapterShape["stopAll"] = () => {
    return Effect.gen(function* () {
      const sessions = yield* Ref.get(sessionsRef);
      for (const [threadId] of sessions) {
        yield* stopSession(threadId);
      }
      if (opencodeProcess) {
        opencodeProcess.kill();
        opencodeProcess = null;
      }
      sessionsIndex.clear();
      isInitialized = false;
    });
  };

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "unsupported" },
    startSession,
    sendTurn,
    interruptTurn,
    readThread,
    rollbackThread,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies OpenCodeAdapterShape;
});

export const OpenCodeAdapterLive = Layer.effect(OpenCodeAdapter, makeOpenCodeAdapter);

export function makeOpenCodeAdapterLive(_options?: OpenCodeAdapterLiveOptions) {
  return Layer.effect(OpenCodeAdapter, makeOpenCodeAdapter);
}
