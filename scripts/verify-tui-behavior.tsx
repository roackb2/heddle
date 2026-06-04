/**
 * Lightweight maintainer verification harness for cli-v2 terminal behavior.
 *
 * This script intentionally verifies only host-side cli-v2 behavior over the
 * shared control-plane API contract. It is not a replacement for domain tests
 * or browser/TUI integration suites.
 *
 * Covered scenarios:
 * - store bootstrap loads sessions, detail, and runtime context through the
 *   shared control-plane API
 * - creating and selecting sessions updates the active cli-v2 snapshot
 * - prompt submission stays on the async control-plane API path
 */
import { ControlPlaneSessionStore } from '../src/cli-v2/state/control-plane-session-store.js';
import type { ControlPlaneProxyClient } from '../src/client-shared/api/proxy.js';
import type {
  ControlPlaneModelOptions,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
  ControlPlaneSessionRuntimeContext,
  ControlPlaneSessionSendPromptAsyncResult,
  ControlPlaneSessionView,
} from '../src/client-shared/api/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createHarnessFixture() {
  const sessions: ControlPlaneSessionView[] = [
    {
      id: 'session-1',
      name: 'Session 1',
      workspaceId: 'workspace-1',
      messageCount: 1,
      turnCount: 0,
      queuedPromptCount: 0,
    },
  ];

  const sessionDetails = new Map<string, NonNullable<ControlPlaneSessionDetail>>([
    ['session-1', createSessionDetail({ id: 'session-1', name: 'Session 1' })],
  ]);
  const runtimeContexts = new Map<string, ControlPlaneSessionRuntimeContext>([
    ['session-1', createRuntimeContext({ sessionId: 'session-1', sessionName: 'Session 1' })],
  ]);

  const calls = {
    sessionsQuery: 0,
    sessionQuery: 0,
    sessionRuntimeContextQuery: 0,
    sessionCreateMutate: 0,
    sessionSendPromptAsyncMutate: 0,
  };

  const pendingApproval: ControlPlanePendingApproval = null;
  let createdCount = 1;

  const client = {
    controlPlane: {
      state: {
        query: async () => ({ activeWorkspaceId: 'workspace-1', workspaces: [] }),
      },
      sessions: {
        query: async () => {
          calls.sessionsQuery += 1;
          return {
            workspaceId: 'workspace-1',
            sessions: sessions.map((session) => ({ ...session })),
          };
        },
      },
      sessionsEvents: {
        subscribe: () => ({ unsubscribe: () => undefined }),
      },
      session: {
        query: async ({ id }: { id: string }) => {
          calls.sessionQuery += 1;
          const detail = sessionDetails.get(id);
          assert(detail, `Missing session detail for ${id}`);
          return detail;
        },
      },
      sessionEvents: {
        subscribe: () => ({ unsubscribe: () => undefined }),
      },
      sessionRunning: {
        query: async () => ({ running: false }),
      },
      sessionRunState: {
        query: async () => ({ running: false, pendingApproval }),
      },
      sessionRuntimeContext: {
        query: async ({ sessionId }: { sessionId: string }) => {
          calls.sessionRuntimeContextQuery += 1;
          const context = runtimeContexts.get(sessionId);
          assert(context, `Missing runtime context for ${sessionId}`);
          return context;
        },
      },
      modelOptions: {
        query: async () => createModelOptions(),
      },
      sessionPendingApproval: {
        query: async () => pendingApproval,
      },
      sessionCreate: {
        mutate: async ({
          suggestedName,
          workspaceId,
        }: {
          suggestedName?: string;
          workspaceId: string;
        }) => {
          calls.sessionCreateMutate += 1;
          createdCount += 1;
          const id = `session-${createdCount}`;
          const name = suggestedName?.trim() || `Session ${createdCount}`;
          const session: ControlPlaneSessionView = {
            id,
            name,
            workspaceId,
            messageCount: 0,
            turnCount: 0,
            queuedPromptCount: 0,
          };

          sessions.unshift(session);
          sessionDetails.set(id, createSessionDetail({
            id,
            name,
            messages: [],
            messageCount: 0,
          }));
          runtimeContexts.set(id, createRuntimeContext({
            sessionId: id,
            sessionName: name,
            model: 'gpt-5.4-mini',
          }));

          return session;
        },
      },
      sessionSendPrompt: {
        mutate: async () => {
          throw new Error('verify-tui-behavior should use sessionSendPromptAsync, not sessionSendPrompt');
        },
      },
      sessionSendPromptAsync: {
        mutate: async ({
          workspaceId,
          sessionId,
          prompt,
        }: {
          workspaceId: string;
          sessionId: string;
          prompt: string;
        }): Promise<ControlPlaneSessionSendPromptAsyncResult> => {
          calls.sessionSendPromptAsyncMutate += 1;
          const current = sessionDetails.get(sessionId);
          assert(current, `Missing session detail for prompt submit ${sessionId}`);

          const queuedMessage = {
            id: `queued-user-${calls.sessionSendPromptAsyncMutate}`,
            role: 'user' as const,
            text: prompt,
            isPending: true,
          };

          sessionDetails.set(sessionId, {
            ...current,
            messageCount: current.messageCount + 1,
            queuedPromptCount: 1,
            messages: [...current.messages, queuedMessage],
          });

          const sessionIndex = sessions.findIndex((entry) => entry.id === sessionId);
          if (sessionIndex >= 0) {
            sessions[sessionIndex] = {
              ...sessions[sessionIndex]!,
              messageCount: current.messageCount + 1,
              queuedPromptCount: 1,
            };
          }

          return {
            accepted: true,
            workspaceId,
            sessionId,
            runId: `run-${calls.sessionSendPromptAsyncMutate}`,
            acceptedAt: '2026-06-04T00:00:00.000Z',
          };
        },
      },
      sessionDirectShellPreflight: {
        query: async () => ({
          command: 'echo hello',
          risk: 'safe',
          tool: 'run_shell_inspect',
          reason: 'simple shell inspection',
        }),
      },
      sessionDirectShellAsync: {
        mutate: async () => {
          throw new Error('verify-tui-behavior should not route these scenarios through direct shell');
        },
      },
      slashCommandCatalog: {
        query: async () => ({
          commands: [
            {
              id: 'model.current',
              syntax: '/model',
              description: 'show the active model',
            },
            {
              id: 'session.list',
              syntax: '/session list',
              description: 'list local chat sessions',
            },
          ],
          hints: [
            { command: '/model', description: 'show the active model' },
            { command: '/session list', description: 'list local chat sessions' },
          ],
        }),
      },
      slashCommandExecute: {
        mutate: async () => ({ handled: true, kind: 'message', message: 'ok' }),
      },
      workspaceFileSearch: {
        query: async () => ({ workspaceId: 'workspace-1', files: [] }),
      },
      sessionContinue: {
        mutate: async () => ({ outcome: 'done', summary: 'Continued.', session: sessionDetails.get('session-1') }),
      },
      sessionCancel: {
        mutate: async () => ({ cancelled: false }),
      },
      sessionResolveApproval: {
        mutate: async () => ({ resolved: true }),
      },
    },
  } as unknown as ControlPlaneProxyClient;

  return { client, calls };
}

async function verifyStoreBootstrap() {
  const fixture = createHarnessFixture();
  const store = new ControlPlaneSessionStore({ client: fixture.client });

  try {
    await store.start();

    const snapshot = store.getSnapshot();
    assert(snapshot.workspaceId === 'workspace-1', 'cli-v2 store did not resolve workspace id');
    assert(snapshot.activeSessionId === 'session-1', 'cli-v2 store did not select the initial session');
    assert(snapshot.activeSession?.messages.at(0)?.text === 'Ready.', 'cli-v2 store did not load initial session detail');
    assert(snapshot.runtimeContext?.sessionId === 'session-1', 'cli-v2 store did not load runtime context');
    assert(fixture.calls.sessionsQuery >= 1, 'cli-v2 store did not query session list');
    assert(fixture.calls.sessionQuery >= 1, 'cli-v2 store did not query session detail');
    assert(fixture.calls.sessionRuntimeContextQuery >= 1, 'cli-v2 store did not query runtime context');

    return {
      workspaceId: snapshot.workspaceId,
      activeSessionId: snapshot.activeSessionId,
      messageCount: snapshot.activeSession?.messages.length ?? 0,
      message: 'store-bootstrap verification passed',
    };
  } finally {
    store.dispose();
  }
}

async function verifySessionCreateAndSwitch() {
  const fixture = createHarnessFixture();
  const store = new ControlPlaneSessionStore({ client: fixture.client });

  try {
    await store.start();
    const created = await store.createSession({ suggestedName: 'Second Session' });
    await store.selectSession(created.id);

    const snapshot = store.getSnapshot();
    assert(created.name === 'Second Session', 'cli-v2 did not preserve suggested session name');
    assert(snapshot.activeSessionId === created.id, 'cli-v2 did not switch to created session');
    assert(snapshot.activeSession?.name === 'Second Session', 'cli-v2 active session detail is stale after switch');
    assert(snapshot.runtimeContext?.sessionId === created.id, 'cli-v2 runtime context did not follow session switch');
    assert(snapshot.runtimeContext?.model === 'gpt-5.4-mini', 'cli-v2 runtime context did not refresh for the new session');

    return {
      createdSessionId: created.id,
      activeSessionId: snapshot.activeSessionId,
      model: snapshot.runtimeContext?.model,
      message: 'session-switch verification passed',
    };
  } finally {
    store.dispose();
  }
}

async function verifyPromptSubmission() {
  const fixture = createHarnessFixture();
  const store = new ControlPlaneSessionStore({ client: fixture.client });

  try {
    await store.start();
    await store.submitPrompt('  Verify cli-v2 prompt submit  ');

    const snapshot = store.getSnapshot();
    assert(fixture.calls.sessionSendPromptAsyncMutate === 1, 'cli-v2 did not use sessionSendPromptAsync');
    assert(snapshot.activeSession?.messages.at(-1)?.text === 'Verify cli-v2 prompt submit', 'cli-v2 did not append the accepted queued user prompt');
    assert(snapshot.activeSession?.messages.at(-1)?.isPending === true, 'cli-v2 did not preserve queued prompt state');

    return {
      activeSessionId: snapshot.activeSessionId,
      lastMessage: snapshot.activeSession?.messages.at(-1)?.text,
      queuedPromptCount: snapshot.activeSession?.queuedPromptCount ?? 0,
      message: 'prompt-submit verification passed',
    };
  } finally {
    store.dispose();
  }
}

function createSessionDetail(overrides: Partial<NonNullable<ControlPlaneSessionDetail>>): NonNullable<ControlPlaneSessionDetail> {
  return {
    id: 'session-1',
    name: 'Session 1',
    workspaceId: 'workspace-1',
    messageCount: 1,
    turnCount: 0,
    queuedPromptCount: 0,
    messages: [
      { id: 'message-1', role: 'assistant', text: 'Ready.' },
    ],
    turns: [],
    queuedPrompts: [],
    ...overrides,
  };
}

function createRuntimeContext(
  overrides: Partial<ControlPlaneSessionRuntimeContext> = {},
): ControlPlaneSessionRuntimeContext {
  return {
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    sessionName: 'Session 1',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
    effectiveReasoningEffort: 'medium',
    reasoningSupported: true,
    reasoningOptions: [
      {
        id: 'default',
        label: 'default',
        description: 'Use gpt-5.4 default (medium)',
        disabled: false,
      },
      {
        id: 'medium',
        label: 'medium',
        description: 'Set explicit medium effort',
        disabled: false,
      },
    ],
    credentialSource: {
      type: 'oauth',
      provider: 'openai',
      accountId: 'acct-test',
      expiresAt: Date.now() + 60_000,
    },
    contextWindow: 400000,
    estimatedInputTokens: undefined,
    driftEnabled: false,
    running: false,
    welcomeGuide: {
      mode: 'conversation',
      hasProviderCredential: true,
      carriesTranscriptAcrossTurns: true,
    },
    ...overrides,
  };
}

function createModelOptions(): ControlPlaneModelOptions {
  return {
    groups: [
      {
        label: 'OpenAI',
        models: ['gpt-5.4', 'gpt-5.4-mini'],
        options: [
          { id: 'gpt-5.4', disabled: false },
          { id: 'gpt-5.4-mini', disabled: false },
        ],
      },
    ],
  };
}

async function main() {
  const storeBootstrap = await verifyStoreBootstrap();
  const sessionSwitch = await verifySessionCreateAndSwitch();
  const promptSubmit = await verifyPromptSubmission();

  console.log(JSON.stringify({
    storeBootstrap,
    sessionSwitch,
    promptSubmit,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
