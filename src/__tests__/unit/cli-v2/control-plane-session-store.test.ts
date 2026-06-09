import { describe, expect, it, vi } from 'vitest';
import type { ControlPlaneProxyClient } from '../../../client-shared/api/proxy.js';
import type {
  ControlPlanePendingApproval,
  ControlPlaneModelOptions,
  ControlPlaneSessionDetail,
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionRuntimeContext,
  ControlPlaneSessionSendPromptAsyncResult,
  ControlPlaneSessionView,
  ControlPlaneSessionsEventEnvelope,
} from '../../../client-shared/api/types.js';
import { createControlPlaneRequestContext } from '../../../client-shared/api/links.js';
import { SLASH_COMMAND_REQUEST_TIMEOUT_MS } from '../../../cli-v2/services/sessions/control-plane-session-api-service.js';
import { ControlPlaneSessionStore } from '../../../cli-v2/state/control-plane-session-store.js';

describe('ControlPlaneSessionStore', () => {
  it('loads workspace sessions through the shared control-plane API', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });

    await store.start();

    expect(fixture.calls.stateQuery).toHaveBeenCalledWith(undefined);
    expect(fixture.calls.modelOptionsQuery).toHaveBeenCalledTimes(1);
    expect(fixture.calls.slashCommandCatalogQuery).toHaveBeenCalledTimes(1);
    expect(fixture.calls.slashCommandCatalogQuery).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(fixture.calls.sessionsQuery).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(fixture.calls.sessionQuery).toHaveBeenCalledWith({ id: 'session-1', workspaceId: 'workspace-1' });
    expect(fixture.calls.sessionRuntimeContextQuery).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
    });
    expect(store.getSnapshot()).toMatchObject({
      workspaceId: 'workspace-1',
      activeSessionId: 'session-1',
      loading: false,
      running: false,
      pendingApproval: null,
      runtimeContext: expect.objectContaining({
        model: 'gpt-5.4',
        effectiveReasoningEffort: 'medium',
      }),
    });
    expect(store.getSnapshot().activeSession?.messages).toEqual([
      { id: 'message-1', role: 'assistant', text: 'Ready.' },
    ]);
    store.dispose();
  });

  it('refreshes runtime context when selecting a different session', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();
    fixture.calls.sessionRuntimeContextQuery.mockResolvedValueOnce(createRuntimeContext({
      sessionId: 'session-2',
      sessionName: 'Session 2',
      model: 'gpt-5.4-mini',
    }));

    await store.selectSession('session-2');

    expect(fixture.calls.sessionRuntimeContextQuery).toHaveBeenLastCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'session-2',
    });
    expect(store.getSnapshot().runtimeContext).toMatchObject({
      sessionId: 'session-2',
      model: 'gpt-5.4-mini',
    });
    store.dispose();
  });

  it('updates permission mode through the shared slash command', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();
    fixture.calls.sessionRuntimeContextQuery.mockResolvedValueOnce(createRuntimeContext({
      permissionMode: 'auto',
      permissionModeOptions: createPermissionModeOptions('auto'),
    }));

    await store.selectPermissionModeFromPicker('auto');

    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/permissions auto',
    }, slashCommandRequestOptions());
    expect(fixture.calls.workspacePermissionModeUpdateMutate).not.toHaveBeenCalled();
    expect(store.getSnapshot().runtimeContext).toMatchObject({
      permissionMode: 'auto',
      permissionModeOptions: [
        expect.objectContaining({ id: 'default' }),
        expect.objectContaining({ id: 'auto' }),
        expect.objectContaining({ id: 'custom' }),
      ],
    });
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

  it('submits selected file mentions as user-authored @path text', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('Look at @AGENTS.md');

    expect(fixture.calls.sessionSendPromptAsyncMutate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      prompt: 'Look at @AGENTS.md',
    }));
    store.dispose();
  });

  it('routes direct shell drafts through the direct shell API', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('!echo hello');

    expect(fixture.calls.sessionDirectShellAsyncMutate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: 'echo hello',
      riskAccepted: undefined,
      apiKey: undefined,
      preferApiKey: undefined,
      systemContext: undefined,
    });
    expect(fixture.calls.sessionSendPromptAsyncMutate).not.toHaveBeenCalled();
    store.dispose();
  });

  it('asks for local confirmation before confirmed-risk direct shell commands', async () => {
    const fixture = createClientFixture({
      directShellPreflight: {
        command: 'rm tmp.txt',
        risk: 'confirmRequired',
        tool: 'run_shell_mutate',
        reason: 'workspace file operation',
      },
    });
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('!rm tmp.txt');

    expect(store.getSnapshot().pendingDirectShellConfirmation).toMatchObject({
      command: 'rm tmp.txt',
      risk: 'confirmRequired',
    });
    expect(fixture.calls.sessionDirectShellAsyncMutate).not.toHaveBeenCalled();

    await store.resolveDirectShellConfirmation(true);

    expect(fixture.calls.sessionDirectShellAsyncMutate).toHaveBeenCalledWith(expect.objectContaining({
      command: 'rm tmp.txt',
      riskAccepted: true,
    }));
    store.dispose();
  });

  it('does not submit an empty direct shell draft as an agent prompt', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('!');

    expect(fixture.calls.sessionDirectShellAsyncMutate).not.toHaveBeenCalled();
    expect(fixture.calls.sessionSendPromptAsyncMutate).not.toHaveBeenCalled();
    expect(store.getSnapshot().error).toBe('Direct shell command cannot be empty.');
    store.dispose();
  });

  it('filters slash command hints locally without querying the API per keystroke', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    expect(store.getSlashCommandHints('/se')).toEqual([
      { command: '/session list', description: 'list local chat sessions' },
      { command: '/session new [name]', description: 'create and switch to a new session' },
    ]);
    expect(store.getSlashCommandHints('/session l')).toEqual([
      { command: '/session list', description: 'list local chat sessions' },
    ]);

    expect(fixture.calls.slashCommandCatalogQuery).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('completes slash command drafts from the cached catalog', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    expect(store.completeSlashCommandDraft('/sess')).toBe('/session ');
    expect(fixture.calls.slashCommandCatalogQuery).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('searches file mention suggestions through the control-plane API', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await expect(store.searchWorkspaceFileMentions('src', 8)).resolves.toEqual([
      { path: 'src/example.ts' },
    ]);

    expect(fixture.calls.workspaceFileSearchQuery).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      query: 'src',
      limit: 8,
    });
    store.dispose();
  });

  it('executes picker selections through slash commands', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.selectModelFromPicker('gpt-5.4-mini');
    await store.selectReasoningFromPicker('medium');
    await store.selectReasoningFromPicker('default');
    await store.selectPermissionModeFromPicker('auto');
    await store.selectSessionFromPicker('session-2');

    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/model gpt-5.4-mini',
    }, slashCommandRequestOptions());
    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/reasoning medium',
    }, slashCommandRequestOptions());
    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenNthCalledWith(3, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/reasoning default',
    }, slashCommandRequestOptions());
    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenNthCalledWith(4, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/permissions auto',
    }, slashCommandRequestOptions());
    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenNthCalledWith(5, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/session switch session-2',
    }, slashCommandRequestOptions());
    expect(fixture.calls.sessionSendPromptAsyncMutate).not.toHaveBeenCalled();
    store.dispose();
  });

  it('runs slash commands through slashCommandExecute instead of prompt submission', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('/model');

    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      command: '/model',
    }, slashCommandRequestOptions());
    expect(fixture.calls.sessionSendPromptAsyncMutate).not.toHaveBeenCalled();
    expect(store.getSnapshot().commandResults.at(-1)).toEqual({
      handled: true,
      kind: 'message',
      message: 'Current model: gpt-5.4',
    });
    expect(store.getSnapshot().commandResultExpanded).toBe(true);
    store.dispose();
  });

  it('collapses command results when a prompt starts running', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('/model');
    expect(store.getSnapshot().commandResultExpanded).toBe(true);

    await store.submitPrompt('Continue with the work');

    expect(store.getSnapshot().commandResultExpanded).toBe(false);
    expect(store.getSnapshot().running).toBe(true);
    store.dispose();
  });

  it('records local TUI command messages without calling slash command execution', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    store.showLocalCommandMessage('No recent edit diffs are available to review.');

    expect(store.getSnapshot().commandResults.at(-1)).toEqual({
      handled: true,
      kind: 'message',
      message: 'No recent edit diffs are available to review.',
    });
    expect(store.getSnapshot().commandResultExpanded).toBe(true);
    expect(fixture.calls.slashCommandExecuteMutate).not.toHaveBeenCalled();
    store.dispose();
  });

  it('collapses command results when a live run-start event arrives', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('/model');
    fixture.sessionEvents?.onData?.({
      type: 'session.event',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      activities: [
        {
          source: 'agent-loop',
          type: 'loop.started',
          runId: 'run-1',
          goal: 'Continue with the work.',
          model: 'gpt-test',
          provider: 'openai',
          workspaceRoot: '/repo',
          timestamp: new Date().toISOString(),
        },
      ],
    } as ControlPlaneSessionEventEnvelope);

    expect(store.getSnapshot().commandResultExpanded).toBe(false);
    store.dispose();
  });

  it('keeps unknown slash commands out of agent prompts', async () => {
    const fixture = createClientFixture();
    fixture.calls.slashCommandExecuteMutate.mockResolvedValueOnce({
      handled: true,
      kind: 'message',
      message: 'Unknown command: /nope. Use the slash command hints to inspect available commands.',
    });
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('/nope');

    expect(fixture.calls.slashCommandExecuteMutate).toHaveBeenCalled();
    expect(fixture.calls.sessionSendPromptAsyncMutate).not.toHaveBeenCalled();
    expect(store.getSnapshot().commandResults.at(-1)).toMatchObject({
      kind: 'message',
      message: 'Unknown command: /nope. Use the slash command hints to inspect available commands.',
    });
    store.dispose();
  });

  it('surfaces slash command timeout details in prompt and command-result UI state', async () => {
    const fixture = createClientFixture();
    fixture.calls.slashCommandExecuteMutate.mockRejectedValueOnce(
      new Error('Control-plane request "controlPlane.slashCommandExecute" timed out after 300000ms.'),
    );
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('/compact');

    expect(store.getSnapshot().error).toBe(
      'Slash command "/compact" timed out waiting for the control plane. '
      + 'Control-plane request "controlPlane.slashCommandExecute" timed out after 300000ms. '
      + 'Server-side work may still finish; watch the activity/status line for follow-up updates.',
    );
    expect(store.getSnapshot().commandResults.at(-1)).toMatchObject({
      handled: true,
      kind: 'message',
      message: store.getSnapshot().error,
    });
    expect(store.getSnapshot().commandResultExpanded).toBe(true);
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

  it('queues another prompt while the selected session is running', async () => {
    const fixture = createClientFixture();
    fixture.calls.sessionRunningQuery.mockResolvedValueOnce({ running: true });
    fixture.calls.sessionSendPromptAsyncMutate.mockResolvedValueOnce(createQueuedResult());
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();

    await store.submitPrompt('Next prompt');

    expect(fixture.calls.sessionSendPromptAsyncMutate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      prompt: 'Next prompt',
    }));
    expect(store.getSnapshot()).toMatchObject({
      running: true,
      latestUpdate: {
        label: 'Prompt queued',
        detail: 'position 1',
        tone: 'info',
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

  it('refreshes pending approval from control-plane approval state events', async () => {
    const fixture = createClientFixture();
    const store = new ControlPlaneSessionStore({ client: fixture.client });
    await store.start();
    fixture.calls.sessionPendingApprovalQuery.mockClear();
    fixture.calls.sessionPendingApprovalQuery.mockResolvedValueOnce(createPendingApproval());

    fixture.sessionEvents?.onData?.({
      type: 'session.approval.updated',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot().pendingApproval).toEqual(expect.objectContaining({
        callId: 'call-1',
        tool: 'run_shell_mutate',
      }));
    });

    expect(fixture.calls.sessionPendingApprovalQuery).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      id: 'session-1',
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
    expect(store.getSnapshot().currentActivity).toEqual(expect.objectContaining({
      label: 'Running read_file',
      detail: 'step 2',
    }));
    expect(store.getSnapshot().liveStatus).toBe('Working... running read_file (step 2)');
    store.dispose();
  });

  it('tracks active plan updates until the run finishes', async () => {
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
          type: 'plan.updated',
          runId: 'run-1',
          step: 1,
          timestamp: new Date().toISOString(),
          explanation: 'Tracking current work.',
          items: [
            { step: 'Inspect', status: 'completed' },
            { step: 'Implement', status: 'in_progress' },
          ],
        },
      ],
    } as ControlPlaneSessionEventEnvelope);

    expect(store.getSnapshot().activePlan?.items).toEqual([
      { step: 'Inspect', status: 'completed' },
      { step: 'Implement', status: 'in_progress' },
    ]);

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

    expect(store.getSnapshot().activePlan).toBeUndefined();
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

function createClientFixture(options: {
  directShellPreflight?: {
    command: string;
    risk: 'safe' | 'confirmRequired' | 'blocked';
    tool?: 'run_shell_inspect' | 'run_shell_mutate';
    reason?: string;
  };
} = {}) {
  const sessionView: ControlPlaneSessionView = {
    id: 'session-1',
    name: 'Session 1',
    workspaceId: 'workspace-1',
    pinned: false,
    messageCount: 1,
    turnCount: 0,
    queuedPromptCount: 0,
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
    sessionRuntimeContextQuery: vi.fn(async () => createRuntimeContext()),
    modelOptionsQuery: vi.fn(async () => createModelOptions()),
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
    sessionDirectShellPreflightQuery: vi.fn(async () => options.directShellPreflight ?? ({
      command: 'echo hello',
      risk: 'safe',
      tool: 'run_shell_inspect',
      reason: 'simple shell inspection',
    })),
    sessionDirectShellAsyncMutate: vi.fn(async () => createAcceptedResult()),
    slashCommandCatalogQuery: vi.fn(async () => ({
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
        {
          id: 'permissions.current',
          syntax: '/permissions',
          description: 'show the active permission mode',
        },
        {
          id: 'session.new',
          syntax: '/session new [name]',
          description: 'create and switch to a new session',
        },
      ],
      hints: [
        { command: '/model', description: 'show the active model' },
        { command: '/permissions set [query]', description: 'pick permission mode with filtering' },
        { command: '/session list', description: 'list local chat sessions' },
        { command: '/session new [name]', description: 'create and switch to a new session' },
      ],
    })),
    slashCommandExecuteMutate: vi.fn(async () => ({
      handled: true,
      kind: 'message',
      message: 'Current model: gpt-5.4',
    })),
    workspaceFileSearchQuery: vi.fn(async () => ({
      workspaceId: 'workspace-1',
      files: [{ path: 'src/example.ts' }],
    })),
    sessionContinueMutate: vi.fn(async () => ({
      outcome: 'done',
      summary: 'Continued.',
      session: sessionDetail,
    })),
    sessionCancelMutate: vi.fn(async () => ({ cancelled: false })),
    sessionResolveApprovalMutate: vi.fn(async () => ({ resolved: true })),
    workspacePermissionModeUpdateMutate: vi.fn(async () => ({
      permissionMode: 'auto',
      permissionModeOptions: createPermissionModeOptions('auto'),
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
      sessionRunState: { query: calls.sessionRunStateQuery },
      sessionRuntimeContext: { query: calls.sessionRuntimeContextQuery },
      modelOptions: { query: calls.modelOptionsQuery },
      sessionPendingApproval: { query: calls.sessionPendingApprovalQuery },
      sessionSendPrompt: { mutate: calls.sessionSendPromptMutate },
      sessionSendPromptAsync: { mutate: calls.sessionSendPromptAsyncMutate },
      sessionDirectShellPreflight: { query: calls.sessionDirectShellPreflightQuery },
      sessionDirectShellAsync: { mutate: calls.sessionDirectShellAsyncMutate },
      slashCommandCatalog: { query: calls.slashCommandCatalogQuery },
      slashCommandExecute: { mutate: calls.slashCommandExecuteMutate },
      workspaceFileSearch: { query: calls.workspaceFileSearchQuery },
      sessionContinue: { mutate: calls.sessionContinueMutate },
      sessionCancel: { mutate: calls.sessionCancelMutate },
      sessionResolveApproval: { mutate: calls.sessionResolveApprovalMutate },
      workspacePermissionModeUpdate: { mutate: calls.workspacePermissionModeUpdateMutate },
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

function createPendingApproval(): NonNullable<ControlPlanePendingApproval> {
  return {
    tool: 'run_shell_mutate',
    callId: 'call-1',
    input: { command: 'touch queued.txt' },
    requestedAt: new Date().toISOString(),
    summary: 'run shell command',
  };
}

function slashCommandRequestOptions() {
  return {
    context: createControlPlaneRequestContext({
      timeoutMs: SLASH_COMMAND_REQUEST_TIMEOUT_MS,
    }),
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
    pinned: false,
    messageCount: 1,
    turnCount: 0,
    queuedPromptCount: 0,
    messages: [
      { id: 'message-1', role: 'assistant', text: 'Ready.' },
    ],
    turns: [],
    queuedPrompts: [],
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
        id: 'low',
        label: 'low',
        description: 'Set explicit low effort',
        disabled: false,
      },
      {
        id: 'medium',
        label: 'medium',
        description: 'Set explicit medium effort',
        disabled: false,
      },
      {
        id: 'high',
        label: 'high',
        description: 'Set explicit high effort',
        disabled: false,
      },
      {
        id: 'ultrahigh',
        label: 'ultrahigh',
        description: 'Set explicit ultrahigh effort',
        disabled: true,
        disabledReason: 'Not supported by request path',
      },
    ],
    permissionMode: 'default',
    permissionModeOptions: createPermissionModeOptions('default'),
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

function createPermissionModeOptions(active: 'default' | 'auto' | 'custom') {
  return [
    {
      id: 'default' as const,
      label: 'Default',
      description: 'Use default permission behavior',
    },
    {
      id: 'auto' as const,
      label: 'Auto',
      description: 'Approve trusted local coding actions',
    },
    {
      id: 'custom' as const,
      label: 'Custom',
      description: 'Use workspace-specific policy',
      disabled: active !== 'custom',
      disabledReason: active === 'custom' ? undefined : 'Custom profile editing is not available yet.',
    },
  ];
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

function createAcceptedResult(): ControlPlaneSessionSendPromptAsyncResult {
  return {
    accepted: true,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    runId: 'session-run-1',
    acceptedAt: '2026-05-27T00:00:00.000Z',
  };
}

function createQueuedResult(): ControlPlaneSessionSendPromptAsyncResult {
  return {
    queued: true,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    queueItemId: 'queued-prompt-1',
    queuedAt: '2026-05-27T00:00:00.000Z',
    position: 1,
  };
}
