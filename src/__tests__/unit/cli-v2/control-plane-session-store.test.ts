import { describe, expect, it, vi } from 'vitest';
import type { ControlPlaneProxyClient } from '../../../client-shared/api/proxy.js';
import type {
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionSendPromptAsyncResult,
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
    store.dispose();
  });

  it('submits prompts through sessionSendPromptAsync without a direct runtime fallback', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({
      client: fixture.client,
      maxSteps: 12,
      searchIgnoreDirs: ['node_modules'],
    });
    await store.start();
    fixture.calls.sessionQuery.mockResolvedValueOnce({
      ...createSessionDetail(),
      messages: [
        ...createSessionDetail().messages,
        {
          id: 'accepted-user-run-1',
          role: 'user',
          text: 'Build the next slice',
          isPending: true,
        },
      ],
    });

    await store.submitPrompt('  Build the next slice  ');

    expect(fixture.calls.sessionSendPromptAsyncMutate).toHaveBeenCalledWith({
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
      id: 'accepted-user-run-1',
      role: 'user',
      text: 'Build the next slice',
      isPending: true,
    });
    store.dispose();
  });

  it('does not finalize a submitted prompt before the send mutation resolves', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createClientFixture();
      const pendingSubmit = createDeferred<Awaited<ReturnType<typeof fixture.calls.sessionSendPromptAsyncMutate>>>();
      fixture.calls.sessionSendPromptAsyncMutate.mockReturnValueOnce(pendingSubmit.promise);
      const store = new ControlPlaneSessionStore({ client: fixture.client });
      await store.start();

      const submit = store.submitPrompt('Wait for the server result');
      await vi.advanceTimersByTimeAsync(800);

      expect(store.getSnapshot()).toMatchObject({
        submitting: true,
        latestUpdate: {
          label: 'Run starting',
          detail: 'waiting for server acceptance',
          tone: 'info',
        },
      });

      pendingSubmit.resolve(createAcceptedResult());
      await submit;
      expect(store.getSnapshot()).toMatchObject({
        submitting: false,
        running: true,
        latestUpdate: {
          label: 'Run accepted',
          detail: 'session-run-1',
          tone: 'info',
        },
      });
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an in-progress submit rejection as active run state', async () => {
    const fixture = createClientFixture();
    fixture.calls.sessionSendPromptAsyncMutate.mockRejectedValueOnce(new Error('A run is already in progress for this session.'));
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('Next prompt');

    expect(store.getSnapshot()).toMatchObject({
      error: undefined,
      running: true,
      submitting: false,
      latestUpdate: {
        label: 'Run already in progress',
        detail: 'waiting for current run to finish',
        tone: 'warning',
      },
    });
    store.dispose();
  });

  it('does not submit another prompt while the selected session is running', async () => {
    const fixture = createClientFixture();
    fixture.calls.sessionRunningQuery.mockResolvedValueOnce({ running: true });
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('Next prompt');

    expect(fixture.calls.sessionSendPromptAsyncMutate).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      running: true,
      latestUpdate: {
        label: 'Run already in progress',
        detail: 'waiting for current run to finish',
        tone: 'warning',
      },
    });
    store.dispose();
  });

  it('cancels the active run through sessionCancel', async () => {
    const fixture = createClientFixture();
    const pendingSubmit = createDeferred<Awaited<ReturnType<typeof fixture.calls.sessionSendPromptAsyncMutate>>>();
    fixture.calls.sessionSendPromptAsyncMutate.mockReturnValueOnce(pendingSubmit.promise);
    fixture.calls.sessionCancelMutate.mockResolvedValueOnce({ cancelled: true });
    fixture.calls.sessionRunningQuery
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce({ running: false });
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    const submit = store.submitPrompt('Long run');
    await store.cancelRun();

    expect(fixture.calls.sessionCancelMutate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'session-1',
    });
    expect(store.getSnapshot()).toMatchObject({
      running: false,
      cancelling: false,
      latestUpdate: {
        label: 'Stop request accepted',
        tone: 'warning',
      },
    });
    pendingSubmit.resolve(createAcceptedResult());
    await submit;
    store.dispose();
  });

  it('resolves pending approvals through the shared control-plane API', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.resolvePendingApproval({ type: 'approve', reason: 'Approved in test' });

    expect(fixture.calls.sessionResolveApprovalMutate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      decision: { type: 'approve', reason: 'Approved in test' },
    });
    expect(store.getSnapshot()).toMatchObject({
      approvalResolving: false,
      latestUpdate: {
        label: 'Approval resolved',
        detail: 'approve',
        tone: 'info',
      },
    });
    store.dispose();
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
          source: 'agent-loop',
          type: 'loop.started',
          runId: 'run-1',
          goal: 'Say hello.',
          model: 'gpt-test',
          provider: 'openai',
          workspaceRoot: '/repo',
          timestamp: new Date().toISOString(),
        },
      ],
    } as ControlPlaneSessionEventEnvelope);
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
    store.dispose();
  });

  it('coalesces rapid live assistant stream events to the newest text', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createClientFixture();
      const store = new ControlPlaneSessionStore({ client: fixture.client });
      await store.start();

      fixture.sessionEvents?.onData?.({
        type: 'session.event',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        activities: [
          {
            source: 'agent-loop',
            type: 'loop.started',
            runId: 'run-1',
            goal: 'Say hello.',
            model: 'gpt-test',
            provider: 'openai',
            workspaceRoot: '/repo',
            timestamp: new Date().toISOString(),
          },
        ],
      } as ControlPlaneSessionEventEnvelope);

      fixture.sessionEvents?.onData?.({
        type: 'session.event',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        activities: [
          { type: 'assistant.stream', text: 'First chunk', done: false },
        ],
      } as ControlPlaneSessionEventEnvelope);
      fixture.sessionEvents?.onData?.({
        type: 'session.event',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        activities: [
          { type: 'assistant.stream', text: 'Second chunk', done: false },
          { type: 'assistant.stream', text: 'Newest chunk', done: false },
        ],
      } as ControlPlaneSessionEventEnvelope);

      expect(store.getSnapshot().activeSession?.messages.at(-1)?.text).toBe('First chunk');

      await vi.advanceTimersByTimeAsync(75);

      expect(store.getSnapshot().activeSession?.messages.at(-1)?.text).toBe('Newest chunk');

      fixture.sessionEvents?.onData?.({
        type: 'session.event',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        activities: [
          { type: 'assistant.stream', text: 'Final text', done: true },
        ],
      } as ControlPlaneSessionEventEnvelope);

      expect(store.getSnapshot().activeSession?.messages.at(-1)).toEqual({
        id: 'live-assistant',
        role: 'assistant',
        text: 'Final text',
        isStreaming: false,
        isPending: false,
      });
      expect(store.getSnapshot().liveStatus).toBe('Receiving assistant response...');
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks the latest non-message activity from the session subscription', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    fixture.sessionEvents?.onData?.({
      type: 'session.event',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      activities: [
        {
          source: 'agent-loop',
          type: 'tool.calling',
          runId: 'run-1',
          step: 2,
          tool: 'read_file',
          toolCallId: 'call-1',
          input: { path: 'README.md' },
          requiresApproval: false,
          timestamp: new Date().toISOString(),
        },
      ],
    } as ControlPlaneSessionEventEnvelope);

    expect(store.getSnapshot().latestUpdate).toEqual({
      label: 'Running read_file',
      detail: 'step 2',
      tone: 'info',
    });
    expect(store.getSnapshot().liveStatus).toBe('Working... running read_file (step 2)');
    store.dispose();
  });

  it('keeps the final run outcome visible after loop completion', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    fixture.sessionEvents?.onData?.({
      type: 'session.event',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      activities: [
        {
          source: 'agent-loop',
          type: 'loop.finished',
          runId: 'run-1',
          outcome: 'done',
          summary: 'Done.',
          timestamp: new Date().toISOString(),
        },
      ],
    } as ControlPlaneSessionEventEnvelope);

    expect(store.getSnapshot().latestUpdate).toEqual({
      label: 'Run finished',
      detail: 'done',
      tone: 'success',
    });
    store.dispose();
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
  const sessionDetail = createSessionDetail();
  const pendingApproval: ControlPlanePendingApproval = null;
  let sessionEvents: SubscriptionOptions<ControlPlaneSessionEventEnvelope> | undefined;
  let sessionsEvents: SubscriptionOptions<ControlPlaneSessionsEventEnvelope> | undefined;
  const calls = {
    stateQuery: vi.fn(async () => ({ activeWorkspaceId: 'workspace-1', workspaces: [] })),
    sessionsQuery: vi.fn(async () => ({ workspaceId: 'workspace-1', sessions: [sessionView] })),
    sessionQuery: vi.fn(async () => sessionDetail),
    sessionRunningQuery: vi.fn(async () => ({ running: false })),
    sessionRunStateQuery: vi.fn(async () => ({ running: false, pendingApproval })),
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
    sessionSendPromptAsyncMutate: vi.fn(async () => createAcceptedResult()),
    sessionCancelMutate: vi.fn(async () => ({ cancelled: false })),
    sessionResolveApprovalMutate: vi.fn(async () => ({ resolved: true })),
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
      sessionRunState: { query: calls.sessionRunStateQuery },
      sessionPendingApproval: { query: calls.sessionPendingApprovalQuery },
      sessionSendPrompt: { mutate: calls.sessionSendPromptMutate },
      sessionSendPromptAsync: { mutate: calls.sessionSendPromptAsyncMutate },
      sessionCancel: { mutate: calls.sessionCancelMutate },
      sessionResolveApproval: { mutate: calls.sessionResolveApprovalMutate },
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createSessionDetail(): NonNullable<ControlPlaneSessionDetail> {
  return {
    id: 'session-1',
    name: 'Session 1',
    workspaceId: 'workspace-1',
    messageCount: 1,
    turnCount: 0,
    messages: [
      { id: 'message-1', role: 'assistant', text: 'Ready.' },
    ],
    turns: [],
  };
}

function createAcceptedResult(): ControlPlaneSessionSendPromptAsyncResult {
  return {
    accepted: true,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    runId: 'session-run-1',
    acceptedAt: '2026-05-27T00:00:00.000Z',
  };
}
