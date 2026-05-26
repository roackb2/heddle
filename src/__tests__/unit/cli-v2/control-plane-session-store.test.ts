import { describe, expect, it, vi } from 'vitest';
import type { ControlPlaneProxyClient } from '../../../client-shared/api/proxy.js';
import type {
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionView,
  ControlPlaneSessionsEventEnvelope,
} from '../../../client-shared/api/types.js';
import { ControlPlaneSessionStore } from '../../../cli-v2/state/control-plane-session-store.js';

describe('ControlPlaneSessionStore', () => {
  it('loads workspace sessions through the shared control-plane API', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });

    await store.start();

    expect(fixture.calls.stateQuery).toHaveBeenCalledWith(undefined);
    expect(fixture.calls.sessionsQuery).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(fixture.calls.sessionQuery).toHaveBeenCalledWith({ id: 'session-1', workspaceId: 'workspace-1' });
    expect(store.getSnapshot()).toMatchObject({
      workspaceId: 'workspace-1',
      activeSessionId: 'session-1',
      loading: false,
      running: false,
      pendingApproval: null,
    });
    expect(store.getSnapshot().activeSession?.messages).toEqual([
      { id: 'message-1', role: 'assistant', text: 'Ready.' },
    ]);
  });

  it('submits prompts through sessionSendPrompt without a direct runtime fallback', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({
      client: fixture.client,
      maxSteps: 12,
      searchIgnoreDirs: ['node_modules'],
    });
    await store.start();

    await store.submitPrompt('  Build the next slice  ');

    expect(fixture.calls.sessionSendPromptMutate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      prompt: 'Build the next slice',
      maxSteps: 12,
      searchIgnoreDirs: ['node_modules'],
      apiKey: undefined,
      preferApiKey: undefined,
      systemContext: undefined,
    });
    expect(store.getSnapshot().activeSession?.messages.at(-1)).toEqual({
      id: 'message-2',
      role: 'assistant',
      text: 'Done.',
    });
  });

  it('applies live assistant stream events from the session subscription', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    fixture.sessionEvents?.onData?.({
      type: 'session.event',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      activities: [
        {
          type: 'assistant.stream',
          text: 'Streaming response',
          done: false,
        },
      ],
    } as ControlPlaneSessionEventEnvelope);

    expect(store.getSnapshot().activeSession?.messages.at(-1)).toEqual({
      id: 'live-assistant',
      role: 'assistant',
      text: 'Streaming response',
      isStreaming: true,
      isPending: true,
    });
    expect(store.getSnapshot().liveStatus).toBe('Receiving assistant response...');
  });
});

type SubscriptionOptions<T> = {
  onStarted?: () => void;
  onData?: (event: T) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
};

function createClientFixture() {
  const sessionView: ControlPlaneSessionView = {
    id: 'session-1',
    name: 'Session 1',
    workspaceId: 'workspace-1',
    messageCount: 1,
    turnCount: 0,
  };
  const sessionDetail: NonNullable<ControlPlaneSessionDetail> = {
    ...sessionView,
    messages: [
      { id: 'message-1', role: 'assistant', text: 'Ready.' },
    ],
    turns: [],
  };
  const pendingApproval: ControlPlanePendingApproval = null;
  let sessionEvents: SubscriptionOptions<ControlPlaneSessionEventEnvelope> | undefined;
  let sessionsEvents: SubscriptionOptions<ControlPlaneSessionsEventEnvelope> | undefined;
  const calls = {
    stateQuery: vi.fn(async () => ({ activeWorkspaceId: 'workspace-1', workspaces: [] })),
    sessionsQuery: vi.fn(async () => ({ workspaceId: 'workspace-1', sessions: [sessionView] })),
    sessionQuery: vi.fn(async () => sessionDetail),
    sessionRunningQuery: vi.fn(async () => ({ running: false })),
    sessionPendingApprovalQuery: vi.fn(async () => pendingApproval),
    sessionSendPromptMutate: vi.fn(async () => ({
      session: {
        ...sessionDetail,
        messages: [
          ...sessionDetail.messages,
          { id: 'message-2', role: 'assistant', text: 'Done.' },
        ],
      },
      outcome: 'completed',
      summary: 'Done.',
    })),
  };
  const client = {
    controlPlane: {
      state: { query: calls.stateQuery },
      sessions: { query: calls.sessionsQuery },
      sessionsEvents: {
        subscribe: vi.fn((_input, options) => {
          sessionsEvents = options;
          return { unsubscribe: vi.fn() };
        }),
      },
      sessionCreate: { mutate: vi.fn() },
      session: { query: calls.sessionQuery },
      sessionEvents: {
        subscribe: vi.fn((_input, options) => {
          sessionEvents = options;
          return { unsubscribe: vi.fn() };
        }),
      },
      sessionRunning: { query: calls.sessionRunningQuery },
      sessionPendingApproval: { query: calls.sessionPendingApprovalQuery },
      sessionSendPrompt: { mutate: calls.sessionSendPromptMutate },
      sessionCancel: { mutate: vi.fn(async () => ({ cancelled: false })) },
      sessionResolveApproval: { mutate: vi.fn(async () => ({ resolved: true })) },
    },
  } as unknown as ControlPlaneProxyClient;

  return {
    client,
    calls,
    get sessionEvents() {
      return sessionEvents;
    },
    get sessionsEvents() {
      return sessionsEvents;
    },
  };
}
