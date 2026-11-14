// An in-process environment for app render scenarios: a fetch stub for its HTTP API and a
// session that answers the shell, thread and config subscriptions from fixtures. Other RPCs
// stay pending so nothing retries on timers. Everything above the wire is the app's own.
import {
  type AssetCreateUrlResult,
  AuthStandardClientScopes,
  EnvironmentId,
  EventId,
  ExecutionEnvironmentDescriptor,
  MessageId,
let holdCommand: (command: OrchestrationV2Command) => boolean = () => false;
let pendingDispatches: Array<{
  readonly command: OrchestrationV2Command;
  readonly reply: Deferred.Deferred<never, OrchestrationV2DispatchCommandError>;
}> = [];
let pendingAssetUrls: Array<Deferred.Deferred<AssetCreateUrlResult>> = [];
let sequence = 1;
let vcsStatusSubscriber: Queue.Queue<VcsStatusStreamEvent> | null = null;

const subscribe = <A>(first: ReadonlyArray<A>, register?: (queue: Queue.Queue<A>) => () => void) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<A>();
      yield* Queue.offerAll(queue, first);
      if (register) {
        const unregister = register(queue);
        yield* Effect.addFinalizer(() => Effect.sync(unregister));
      }
      return Stream.fromQueue(queue);
    }),
  );

const handlers: Record<string, (input: never) => unknown> = {
  // Recorded, and accepted only when the scenario asks, since a pending command holds every
  // later command on its thread. Accepted commands' events never arrive.
  [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command: OrchestrationV2Command) =>
    Effect.suspend(() => {
      dispatched.push(command);
      return acceptCommands ? Effect.succeed({ sequence: sequence + 1 }) : Effect.never;
    }),
  // Held like any other unanswered call, until `answerAssetUrls`.
  [WS_METHODS.assetsCreateUrl]: () =>
    Effect.suspend(() => {
      const reply = Deferred.makeUnsafe<AssetCreateUrlResult>();
      pendingAssetUrls.push(reply);
      return Deferred.await(reply);
    }),
  [WS_METHODS.subscribeTerminalMetadata]: () =>
    subscribe<TerminalMetadataStreamEvent>([{ type: "snapshot", terminals: [] }], (queue) => {
      terminalMetadataSubscriber = queue;
      return () => {
        if (terminalMetadataSubscriber === queue) terminalMetadataSubscriber = null;
      };
    }),
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () =>
    subscribe<OrchestrationV2ShellStreamItem>([
      {
        kind: "snapshot",
        snapshot: {
          schemaVersion: 1,
          snapshotSequence: sequence,
          projects: [project],
          threads: threads.filter((thread) => !thread.olderSettled).map(shellOf),
          archivedThreads: [],
        },
      },
      { kind: "synchronized" },
    ]),
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: (input: { readonly threadId: ThreadId }) => {
    const thread = threads.find((candidate) => candidate.id === input.threadId);
    if (!thread) return Stream.never;
    return subscribe<OrchestrationV2ThreadStreamItem>(
      [
        { kind: "snapshot", snapshotSequence: sequence, projection: projectionOf(thread) },
        { kind: "synchronized" },
      ],
      (queue) => {
        threadSubscribers.set(thread.id, queue);

        // A replaced subscription closes after its successor registers.
        return () => {
          if (threadSubscribers.get(thread.id) === queue) threadSubscribers.delete(thread.id);
        };
      },
    );
  },
  [ORCHESTRATION_V2_WS_METHODS.getThreadFamily]: (input: { readonly threadId: ThreadId }) => {
    const rootOf = (thread: FakeThread) => thread.sideChatOf ?? thread.id;
    const requested = threads.find((candidate) => candidate.id === input.threadId);
    return Effect.succeed({
      snapshotSequence: sequence,
      threads: requested
        ? threads.filter((thread) => rootOf(thread) === rootOf(requested)).map(shellOf)
        : [],
    });
  },
  [WS_METHODS.subscribeVcsStatus]: () =>
    subscribe<VcsStatusStreamEvent>([], (queue) => {
      vcsStatusSubscriber = queue;
      return () => {
        if (vcsStatusSubscriber === queue) vcsStatusSubscriber = null;
      };
    }),
  [WS_METHODS.subscribeServerConfig]: () =>
    subscribe([{ version: 1 as const, type: "snapshot" as const, config: serverConfig() }]),
};

// Unanswered calls stay pending, like a server that has not replied yet.
const client = new Proxy(handlers, {
  get: (target, method: string) =>
    target[method] ??
    (() => {
      const rpc = WsRpcGroup.requests.get(method);
      return rpc && RpcSchema.isStreamSchema(rpc.successSchema) ? Stream.never : Effect.never;
    }),
});

const session: EnvironmentConnectionLease["session"] = {
  client: client as unknown as WsRpcProtocolClient,
  initialConfig: Effect.sync(serverConfig),
  subscribeServerConfig: () =>
    subscribe([{ version: 1 as const, type: "snapshot" as const, config: serverConfig() }]),
  ready: Effect.void,
  probe: Effect.void,
  inboundFrames: Effect.succeed(0),
  closed: Effect.never,
};

/** Stands in for client-runtime's ConnectionDriver: every connection opens the session above. */
export const fakeDriver = {
  connect: (
    entry: ConnectionCatalogEntry,
  ): Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope> =>
    Effect.succeed({
      prepared: {
        environmentId: ENVIRONMENT_ID,
        label: descriptor.label,
        httpBaseUrl: window.location.origin,
        socketUrl: window.location.origin.replace(/^http/, "ws"),
        httpAuthorization: null,
        target: entry.target,
      },
      session,
    }),
  preflight: () => Effect.succeed(true),
  checkHost: () => Effect.succeed<RouteCheck>("unchecked"),
};
export type FakeDriver = typeof fakeDriver;

const realFetch = globalThis.fetch;
const encodedDescriptor = Schema.encodeSync(ExecutionEnvironmentDescriptor)(
  Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor)(descriptor),
);

/** Serves the environment's HTTP API and these threads until disposed. */
export function installFakeEnvironment(
  fixtures: ReadonlyArray<FakeThread>,
  options?: { readonly acceptCommands?: boolean; readonly providers?: ReadonlyArray<unknown> },
): Disposable {
  threads = fixtures;
  baseServerConfig = makeServerConfig(options?.providers ?? [CODEX_PROVIDER]);
  dispatched = [];
  acceptCommands = options?.acceptCommands === true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== window.location.origin) return realFetch(input, init);
    if (url.pathname === "/.well-known/t3/environment") return json(encodedDescriptor);
    if (url.pathname === "/api/auth/session") {
      return json({
        authenticated: true,
        auth,
        scopes: AuthStandardClientScopes,
        sessionMethod: "browser-session-cookie",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    }
    // Snapshot endpoints fall back to the socket, which serves the same fixtures.
    if (/^\/(api|oauth|\.well-known)\//.test(url.pathname)) return json({}, 404);
    return realFetch(input, init);
  };
  return {
    [Symbol.dispose]: () => {
      globalThis.fetch = realFetch;
      threads = [];
      baseServerConfig = makeServerConfig([CODEX_PROVIDER]);
      dispatched = [];
      acceptCommands = false;
      projects = [project];
      holdCommand = () => false;
      pendingDispatches = [];
      pendingAssetUrls = [];
    },
  };
}


export function hasPendingAssetUrl(): boolean {
  return pendingAssetUrls.length > 0;
}

/** Answers every held asset URL request, as a server that still has the file. */
export async function answerAssetUrls(): Promise<void> {
  const replies = pendingAssetUrls;
  pendingAssetUrls = [];
  for (const reply of replies) {
    await Effect.runPromise(
      Deferred.succeed(reply, { relativeUrl: "/api/assets/fake", expiresAt: 4_102_444_800_000 }),
    );
  }
}

/** Commands the app dispatched to the environment, oldest first. */
export function dispatchedCommands(): ReadonlyArray<OrchestrationV2Command> {
  return dispatched;
}

type ThreadEvent = Extract<OrchestrationV2ThreadStreamItem, { readonly kind: "event" }>["event"];

export async function emitTerminalMetadata(event: TerminalMetadataStreamEvent): Promise<void> {
  if (terminalMetadataSubscriber === null) throw new Error("No terminal metadata subscription");
  await Effect.runPromise(Queue.offer(terminalMetadataSubscriber, event));
}

/** Whether the app holds a live subscription to the thread, so events reach it. */
export function isThreadSubscribed(threadId: ThreadId): boolean {
  return threadSubscribers.has(threadId);
}

/** Delivers one domain event, such as a run or turn-item update, to the thread's subscription. */
export async function emitThreadEvent(
  threadId: ThreadId,
  event: Pick<ThreadEvent, "type" | "payload">,
): Promise<void> {
  const queue = threadSubscribers.get(threadId);
  if (!queue) throw new Error(`No live subscription for ${threadId}`);
  sequence += 1;
  await Effect.runPromise(
    Queue.offer(queue, {
      kind: "event",
      sequence,
      event: { ...event, id: EventId.make(`event-${sequence}`), threadId, occurredAt: AT },
    } as OrchestrationV2ThreadStreamItem),
  );
}

export function runningRun(threadId: ThreadId, id: string, ordinal: number, userMessageId: string) {
  return {
    ...run(threadId, RunId.make(id), ordinal, userMessageId),
    status: "running" as const,
    completedAt: null,
  };
}

export { userItem };

export async function emitVcsStatus(event: VcsStatusStreamEvent): Promise<void> {
  if (vcsStatusSubscriber === null) throw new Error("No VCS status subscription");
  await Effect.runPromise(Queue.offer(vcsStatusSubscriber, event));
}
