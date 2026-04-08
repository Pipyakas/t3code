import { randomUUID } from "node:crypto";
import { Effect, Layer, Queue, Ref, Stream } from "effect";

import { EventId, type ProviderRuntimeEvent, type ThreadId, TurnId } from "@t3tools/contracts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterRequestError, ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import { GeminiAdapter, type GeminiAdapterShape } from "../Services/GeminiAdapter.ts";

const PROVIDER = "gemini" as const;
const DEFAULT_GEMINI_BINARIES = ["gemini", "gemini-cli"] as const;

const resolveGeminiBinaryCandidates = (binaryPath: string | null | undefined) => {
  const configured = binaryPath?.trim();
  return configured ? [configured] : [...DEFAULT_GEMINI_BINARIES];
};

const trySpawnGeminiProcess = (binaryPath: string, args: ReadonlyArray<string>) => {
  try {
    return { child: Bun.spawn([binaryPath, ...args], { stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
};

export const makeGeminiAdapterLive = () =>
  Layer.effect(
    GeminiAdapter,
    Effect.gen(function* () {
      const settingsService = yield* ServerSettingsService;
      const sessionsRef = yield* Ref.make(new Set<ThreadId>());
      const processByThreadRef = yield* Ref.make(new Map<ThreadId, ReturnType<typeof Bun.spawn>>());
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

      const startSession: GeminiAdapterShape["startSession"] = (input) =>
        Effect.gen(function* () {
          yield* Ref.update(sessionsRef, (sessions) => new Set(sessions).add(input.threadId));
          const now = new Date().toISOString();
          return {
            provider: PROVIDER,
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            status: "ready",
            ...(input.cwd ? { cwd: input.cwd } : {}),
            createdAt: now,
            updatedAt: now,
          };
        });

      const sendTurn: GeminiAdapterShape["sendTurn"] = (input) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);
          if (!sessions.has(input.threadId)) {
            return yield* new ProviderAdapterSessionNotFoundError({
              provider: PROVIDER,
              threadId: input.threadId,
              cause: undefined,
            });
          }

          const settings = yield* settingsService.getSettings;
          const binaryCandidates = resolveGeminiBinaryCandidates(
            settings.providers.gemini.binaryPath,
          );
          const turnId = TurnId.makeUnsafe(randomUUID());
          const args = ["--prompt", input.input ?? ""];
          if (input.modelSelection?.provider === PROVIDER) {
            args.push("--model", input.modelSelection.model);
          }

          yield* Queue.offer(runtimeEventQueue, {
            type: "turn.started",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            createdAt: new Date().toISOString(),
            payload:
              input.modelSelection?.provider === PROVIDER
                ? { model: input.modelSelection.model }
                : {},
          });

          let child: ReturnType<typeof Bun.spawn> | null = null;
          let lastSpawnError: Error = new Error("Gemini CLI binary was not found");
          for (const candidate of binaryCandidates) {
            const spawnAttempt = trySpawnGeminiProcess(candidate, args);
            if (spawnAttempt.child) {
              child = spawnAttempt.child;
              break;
            }
            lastSpawnError = spawnAttempt.error;
          }
          if (!child) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "sendTurn",
              detail: lastSpawnError.message,
              cause: lastSpawnError,
            });
          }
          yield* Ref.update(processByThreadRef, (processes) =>
            new Map(processes).set(input.threadId, child),
          );

          const childStdout = child.stdout as ReadableStream<Uint8Array> | undefined;
          const childStderr = child.stderr as ReadableStream<Uint8Array> | undefined;
          const [stdout, stderr, exitCode] = yield* Effect.all([
            Effect.promise(() =>
              childStdout ? new Response(childStdout).text() : Promise.resolve(""),
            ),
            Effect.promise(() =>
              childStderr ? new Response(childStderr).text() : Promise.resolve(""),
            ),
            Effect.promise(() => child.exited),
          ]);

          const text = stdout.trim() || stderr.trim();
          if (text.length > 0) {
            yield* Queue.offer(runtimeEventQueue, {
              type: "content.delta",
              eventId: EventId.makeUnsafe(randomUUID()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              createdAt: new Date().toISOString(),
              payload: { streamKind: "assistant_text", delta: text },
            });
          }

          yield* Queue.offer(runtimeEventQueue, {
            type: "turn.completed",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            createdAt: new Date().toISOString(),
            payload: { state: exitCode === 0 ? "completed" : "failed" },
          });

          yield* Ref.update(processByThreadRef, (processes) => {
            const next = new Map(processes);
            next.delete(input.threadId);
            return next;
          });

          return { threadId: input.threadId, turnId };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "sendTurn",
                detail: cause instanceof Error ? cause.message : "sendTurn failed",
                cause,
              }),
          ),
        );

      return {
        provider: PROVIDER,
        capabilities: { sessionModelSwitch: "restart-session" },
        startSession,
        sendTurn,
        interruptTurn: (threadId) =>
          Ref.get(processByThreadRef).pipe(
            Effect.tap((processes) => Effect.sync(() => processes.get(threadId)?.kill())),
            Effect.asVoid,
          ),
        respondToRequest: () => Effect.void,
        respondToUserInput: () => Effect.void,
        stopSession: (threadId) =>
          Effect.gen(function* () {
            yield* Ref.update(sessionsRef, (sessions) => {
              const next = new Set(sessions);
              next.delete(threadId);
              return next;
            });
            yield* Ref.update(processByThreadRef, (processes) => {
              const next = new Map(processes);
              next.get(threadId)?.kill();
              next.delete(threadId);
              return next;
            });
          }),
        listSessions: () =>
          Ref.get(sessionsRef).pipe(
            Effect.map((sessions) => {
              const now = new Date().toISOString();
              return Array.from(sessions).map((threadId) => ({
                provider: PROVIDER,
                threadId,
                runtimeMode: "full-access" as const,
                status: "ready" as const,
                createdAt: now,
                updatedAt: now,
              }));
            }),
          ),
        hasSession: (threadId) =>
          Ref.get(sessionsRef).pipe(Effect.map((sessions) => sessions.has(threadId))),
        readThread: () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "readThread",
              detail: "Not implemented",
            }),
          ),
        rollbackThread: () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "rollbackThread",
              detail: "Not implemented",
            }),
          ),
        stopAll: () =>
          Effect.gen(function* () {
            yield* Ref.update(processByThreadRef, (processes) => {
              for (const child of processes.values()) child.kill();
              return new Map();
            });
            yield* Ref.set(sessionsRef, new Set());
          }),
        streamEvents: Stream.fromQueue(runtimeEventQueue),
      } satisfies GeminiAdapterShape;
    }),
  );

export const GeminiAdapterLive = makeGeminiAdapterLive();
