import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialCommandService, ProviderCredentialRepository } from '@/core/auth/index.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import { RuntimeWorkspaceService, type WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { createLocalHeddleServerRequestAccess } from '@/server/access/index.js';
import { controlPlaneRouter } from '@/server/routes/trpc/control-plane.js';
import type {
  ControlPlaneSessionEventEnvelope,
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionsEventEnvelope,
} from '@/server/control-plane-types.js';
import type { HeddleServerContext } from '@/server/types.js';

const EXTERNAL_TUI_LEASE_OWNER: ChatSessionLeaseOwner = {
  ownerKind: 'tui',
  hostId: 'external-host',
  ownerId: 'external-tui-client',
  clientLabel: 'terminal chat',
};

describe('control-plane session lifecycle API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('renames sessions through the workspace-scoped API', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Original name' });

    const renamed = await caller.sessionRename({
      id: session.id,
      name: 'Renamed from API',
    });

    expect(renamed.name).toBe('Renamed from API');
    await expect(caller.session({ id: session.id })).resolves.toMatchObject({
      id: session.id,
      name: 'Renamed from API',
    });
  });

  it('pins sessions through the workspace-scoped API and lists pinned sessions first', async () => {
    const { caller } = createControlPlaneCaller();
    const older = await caller.sessionCreate({ name: 'Older session' });
    const newer = await caller.sessionCreate({ name: 'Newer session' });

    const pinned = await caller.sessionPinnedUpdate({
      id: older.id,
      pinned: true,
    });

    expect(pinned).toMatchObject({
      id: older.id,
      pinned: true,
    });
    await expect(caller.session({ id: older.id })).resolves.toMatchObject({
      id: older.id,
      pinned: true,
    });
    await expect(caller.sessions()).resolves.toMatchObject({
      sessions: [
        expect.objectContaining({ id: older.id, pinned: true }),
        expect.objectContaining({ id: newer.id, pinned: false }),
      ],
    });

    await expect(caller.sessionPinnedUpdate({
      id: older.id,
      pinned: false,
    })).resolves.toMatchObject({
      id: older.id,
      pinned: false,
    });
  });

  it('archives sessions through the workspace-scoped API and hides them from session lists', async () => {
    const { caller } = createControlPlaneCaller();
    const archivedSession = await caller.sessionCreate({ name: 'Archive me' });
    const visibleSession = await caller.sessionCreate({ name: 'Keep visible' });

    const archived = await caller.sessionArchivedUpdate({
      id: archivedSession.id,
      archived: true,
    });

    expect(archived).toMatchObject({
      id: archivedSession.id,
      archivedAt: expect.any(String),
    });
    await expect(caller.session({ id: archivedSession.id })).resolves.toMatchObject({
      id: archivedSession.id,
      archivedAt: archived.archivedAt,
    });
    await expect(caller.sessions()).resolves.toMatchObject({
      sessions: [expect.objectContaining({ id: visibleSession.id })],
    });

    const restored = await caller.sessionArchivedUpdate({
      id: archivedSession.id,
      archived: false,
    });

    expect(restored.archivedAt).toBeUndefined();
    await expect(caller.sessions()).resolves.toMatchObject({
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: archivedSession.id }),
        expect.objectContaining({ id: visibleSession.id }),
      ]),
    });
  });

  it('scopes lifecycle mutations to the requested workspace', async () => {
    const { caller, activeWorkspace, secondaryWorkspace, createEngineForWorkspace } = createControlPlaneCaller();
    const defaultEngine = createEngineForWorkspace(activeWorkspace.id);
    const secondaryEngine = createEngineForWorkspace(secondaryWorkspace.id);
    await defaultEngine.sessions.create({
      id: 'same-session-id',
      name: 'Default workspace session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });
    await secondaryEngine.sessions.create({
      id: 'same-session-id',
      name: 'Secondary workspace session',
      apiKeyPresent: true,
      workspaceId: secondaryWorkspace.id,
    });

    await caller.sessionRename({
      workspaceId: secondaryWorkspace.id,
      id: 'same-session-id',
      name: 'Renamed secondary session',
    });

    await expect(caller.session({ workspaceId: activeWorkspace.id, id: 'same-session-id' })).resolves.toMatchObject({
      id: 'same-session-id',
      name: 'Default workspace session',
    });
    await expect(caller.session({ workspaceId: secondaryWorkspace.id, id: 'same-session-id' })).resolves.toMatchObject({
      id: 'same-session-id',
      name: 'Renamed secondary session',
    });
  });

  it('deletes sessions and leaves the session catalog readable', async () => {
    const { caller } = createControlPlaneCaller();
    const deletedSession = await caller.sessionCreate({ name: 'Delete me' });
    const keptSession = await caller.sessionCreate({ name: 'Keep me' });

    await expect(caller.sessionDelete({ id: deletedSession.id })).resolves.toEqual({ deleted: true });

    const sessions = await caller.sessions();
    expect(sessions.sessions.map((session) => session.id)).toContain(keptSession.id);
    expect(sessions.sessions.map((session) => session.id)).not.toContain(deletedSession.id);
    await expect(caller.session({ id: deletedSession.id })).resolves.toBeNull();
  });

  it('resets session transcript state through the API', async () => {
    const { caller, engine, activeWorkspace } = createControlPlaneCaller();
    const session = await engine.sessions.create({
      id: 'session-reset-api',
      name: 'Reset API session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });
    await engine.sessions.appendMessage(session.id, {
      id: 'local-user-message',
      role: 'user',
      text: 'old visible message',
    });
    await engine.sessions.setLastContinuePrompt(session.id, 'continue old work');

    const reset = await caller.sessionReset({ id: session.id });

    expect(reset.messages.map((message) => message.text)).not.toContain('old visible message');
    expect(reset.turns).toEqual([]);
    expect(reset.lastContinuePrompt).toBeUndefined();
    await expect(caller.session({ id: session.id })).resolves.toMatchObject({
      id: session.id,
      turns: [],
    });
  });

  it('runs direct shell through the control-plane session API', async () => {
    const { caller, engine, activeWorkspace } = createControlPlaneCaller();
    const session = await engine.sessions.create({
      id: 'direct-shell-api',
      name: 'Direct shell API session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });

    await expect(caller.sessionDirectShellAsync({
      sessionId: session.id,
      command: 'echo hello',
    })).resolves.toMatchObject({
      accepted: true,
      sessionId: session.id,
    });

    await vi.waitFor(async () => {
      await expect(caller.session({ id: session.id })).resolves.toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', text: '!echo hello' }),
          expect.objectContaining({
            role: 'assistant',
            directShellResult: expect.objectContaining({
              command: 'echo hello',
              outcome: 'done',
              stdout: 'hello',
            }),
          }),
        ]),
      });
    });
  });

  it('preflights direct shell risk before interfaces ask for confirmation', async () => {
    const { caller, engine, activeWorkspace } = createControlPlaneCaller();
    const session = await engine.sessions.create({
      id: 'direct-shell-preflight-api',
      name: 'Direct shell preflight API session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });

    await expect(caller.sessionDirectShellPreflight({
      sessionId: session.id,
      command: 'echo hello',
    })).resolves.toMatchObject({
      command: 'echo hello',
      risk: 'safe',
      tool: 'run_shell_inspect',
    });

    await expect(caller.sessionDirectShellPreflight({
      sessionId: session.id,
      command: 'rm tmp.txt',
    })).resolves.toMatchObject({
      command: 'rm tmp.txt',
      risk: 'confirmRequired',
      tool: 'run_shell_mutate',
    });
  });

  it('blocks destructive lifecycle mutations while another client owns the session lease', async () => {
    const { caller, engine, activeWorkspace } = createControlPlaneCaller();
    const session = await engine.sessions.create({
      id: 'leased-session-api',
      name: 'Leased API session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });
    await engine.sessions.acquireLease(session.id, EXTERNAL_TUI_LEASE_OWNER);

    await expect(caller.sessionDelete({ id: session.id })).rejects.toThrow('already active');
    await expect(caller.sessionReset({ id: session.id })).rejects.toThrow('already active');
    await expect(caller.sessionCompact({ id: session.id, force: true })).rejects.toThrow('already active');
    await expect(caller.sessionSendPromptAsync({
      sessionId: session.id,
      prompt: 'should not be accepted',
    })).rejects.toThrow('already active');
    await expect(caller.sessionRunState({ id: session.id })).resolves.toEqual({
      running: false,
      activeRun: null,
      pendingApproval: null,
    });
    expect((await engine.sessions.require(session.id)).messages.map((message) => message.text)).not.toContain('should not be accepted');
  });

  it('compacts a session through the API without requiring clients to call compaction services', async () => {
    const { caller, engine, activeWorkspace } = createControlPlaneCaller();
    const session = await engine.sessions.create({
      id: 'session-compact-api',
      name: 'Compact API session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });
    await engine.sessions.update(session.id, (current) => ({
      ...current,
      history: [
        { role: 'user', content: 'summarize this small transcript' },
        { role: 'assistant', content: 'small transcript response' },
      ],
    }));

    const compacted = await caller.sessionCompact({ id: session.id, force: true });

    expect(compacted.id).toBe(session.id);
    expect(compacted.context?.estimatedHistoryTokens).toEqual(expect.any(Number));
    await expect(caller.session({ id: session.id })).resolves.toMatchObject({
      id: session.id,
      context: expect.objectContaining({
        estimatedHistoryTokens: expect.any(Number),
      }),
    });
  });

  it('restores prior compaction state when manual compaction fails', async () => {
    const { caller, engine, activeWorkspace } = createControlPlaneCaller();
    const session = await engine.sessions.create({
      id: 'session-compact-failure-api',
      name: 'Compact failure API session',
      apiKeyPresent: true,
      workspaceId: activeWorkspace.id,
    });
    const priorContext = {
      estimatedHistoryTokens: 42,
      compaction: { status: 'idle' as const },
      archive: { count: 1, currentSummaryPath: '.heddle/archive-summary.md' },
    };
    const priorArchives = [{
      id: 'archive-1',
      path: '.heddle/archive-1.jsonl',
      summaryPath: '.heddle/archive-summary.md',
      messageCount: 2,
      createdAt: '2026-05-26T00:00:00.000Z',
    }];
    await engine.sessions.update(session.id, (current) => ({
      ...current,
      history: [{ role: 'user', content: 'please compact then fail' }],
      context: priorContext,
      archives: priorArchives,
    }));
    vi.spyOn(ConversationCompactionService, 'compact').mockRejectedValueOnce(new Error('forced compaction failure'));

    await expect(caller.sessionCompact({ id: session.id, force: true })).rejects.toThrow('forced compaction failure');
    expect((await engine.sessions.require(session.id)).context).toEqual(priorContext);
    expect((await engine.sessions.require(session.id)).archives).toEqual(priorArchives);
  });

  it('returns combined run state for a session', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Run state session' });

    await expect(caller.sessionRunState({ id: session.id })).resolves.toEqual({
      running: false,
      activeRun: null,
      pendingApproval: null,
    });
  });

  it('returns core slash command catalog metadata through the control-plane API', async () => {
    const { caller } = createControlPlaneCaller();

    const catalog = await caller.slashCommandCatalog();

    expect(catalog.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'help.show',
        syntax: '/help',
        description: 'show available slash commands',
      }),
      expect.objectContaining({
        id: 'model.current',
        syntax: '/model',
        description: 'show the active model',
      }),
    ]));
    expect(catalog.hints).toEqual(expect.arrayContaining([
      { command: '/help', description: 'show available slash commands' },
      { command: '/permissions set [query]', description: 'pick permission mode with filtering' },
      { command: '/session list', description: 'list local chat sessions' },
    ]));
  });

  it('executes slash commands through core command semantics', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Slash command session', model: 'gpt-5.4' });

    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/model',
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Current model: gpt-5.4',
    });
    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/permissions auto',
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Set permission mode to auto.',
    });
  });

  it('enables and lists Agent Skills through shared slash commands', async () => {
    const { caller, activeWorkspace } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Skills slash command session' });
    writeSkillSync(activeWorkspace.workspaceRoot, 'browser-research', `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research
`);

    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/skills',
    })).resolves.toMatchObject({
      handled: true,
      kind: 'message',
      message: expect.stringContaining('Available ('),
    });
    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/skills',
    })).resolves.toMatchObject({
      handled: true,
      kind: 'message',
      message: expect.stringContaining([
        '- browser-research',
        '  Research web pages through a browser.',
        '  source=project',
        '  action=/skills enable browser-research',
      ].join('\n')),
    });
    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/skills enable browser-research',
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Activated Agent Skill browser-research. It will be available to future agent turns in this workspace.',
    });
    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/skills',
    })).resolves.toMatchObject({
      handled: true,
      kind: 'message',
      message: expect.stringContaining('Active (1)\n- browser-research'),
    });
  });

  it('manages Agent Skills through the workspace-scoped API', async () => {
    const { caller, activeWorkspace } = createControlPlaneCaller();
    writeSkillSync(activeWorkspace.workspaceRoot, 'browser-research', `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research
`);

    await expect(caller.skills({ workspaceId: activeWorkspace.id })).resolves.toMatchObject({
      activationStorePath: expect.stringContaining('.heddle/skills/activation.json'),
      skills: expect.arrayContaining([
        expect.objectContaining({
          name: 'browser-research',
          status: 'available',
          catalogEntry: expect.objectContaining({
            description: 'Research web pages through a browser.',
            source: 'project',
          }),
        }),
      ]),
      issues: [],
    });

    await expect(caller.skillActivate({
      workspaceId: activeWorkspace.id,
      name: 'browser-research',
    })).resolves.toMatchObject({
      ok: true,
      record: expect.objectContaining({
        name: 'browser-research',
        status: 'active',
      }),
    });
    await expect(caller.skills({ workspaceId: activeWorkspace.id })).resolves.toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({
          name: 'browser-research',
          status: 'active',
        }),
      ]),
    });

    await expect(caller.skillDisable({
      workspaceId: activeWorkspace.id,
      name: 'browser-research',
    })).resolves.toMatchObject({
      ok: true,
      record: expect.objectContaining({
        name: 'browser-research',
        status: 'disabled',
      }),
    });
    await expect(caller.skills({ workspaceId: activeWorkspace.id })).resolves.toMatchObject({
      skills: expect.arrayContaining([
        expect.objectContaining({
          name: 'browser-research',
          status: 'disabled',
        }),
      ]),
    });
  });

  it('executes auth login through the shared core auth command service', async () => {
    const login = vi.spyOn(ProviderCredentialCommandService, 'loginProviderWithOAuth')
      .mockResolvedValue('Stored OpenAI OAuth credential.');
    const { caller, activeWorkspace } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Auth slash command session' });

    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/auth login openai',
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Stored OpenAI OAuth credential.',
    });
    expect(login).toHaveBeenCalledWith('openai', {
      storePath: ProviderCredentialRepository.resolveStorePath(activeWorkspace.stateRoot),
    });
  });

  it('returns selected-session runtime context for commands and status surfaces', async () => {
    const { caller, activeWorkspace } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Runtime context session', model: 'gpt-5.4' });
    await caller.sessionSettingsUpdate({
      id: session.id,
      reasoningEffort: 'medium',
      driftEnabled: true,
    });

    await expect(caller.sessionRuntimeContext({
      sessionId: session.id,
    })).resolves.toMatchObject({
      workspaceId: activeWorkspace.id,
      sessionId: session.id,
      sessionName: 'Runtime context session',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      effectiveReasoningEffort: 'medium',
      reasoningSupported: true,
      contextWindow: 400000,
      driftEnabled: true,
      running: false,
      welcomeGuide: {
        mode: 'conversation',
        hasProviderCredential: expect.any(Boolean),
        carriesTranscriptAcrossTurns: true,
      },
    });
  });

  it('returns visible errors for unknown slash commands', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Unknown slash command session' });

    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/not-real',
    })).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Unknown command: /not-real. Use the slash command hints to inspect available commands.',
    });
  });

  it('executes help as a stable slash command result', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Help slash command session' });

    await expect(caller.slashCommandExecute({
      sessionId: session.id,
      command: '/help',
    })).resolves.toMatchObject({
      handled: true,
      kind: 'message',
      message: expect.stringContaining('Slash commands\n\n/help\nShow available slash commands.'),
    });
  });

  it('accepts async prompt submits before the final session result is ready', async () => {
    vi.stubEnv('HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT', '1');
    vi.stubEnv('HEDDLE_BROWSER_INTEGRATION_FAKE_STREAM_PREVIEW_MS', '100');
    try {
      const { caller, activeWorkspace } = createControlPlaneCaller();
      const session = await caller.sessionCreate({ name: 'Async submit session' });
      const sessionLifecycle = await caller.sessionEvents({ sessionId: session.id });
      const sessionLifecycleIterator = sessionLifecycle[Symbol.asyncIterator]();
      const startedRuns = collectStartedRuns(sessionLifecycleIterator, 2);
      const workspaceLifecycle = await caller.sessionsEvents();
      const workspaceLifecycleIterator = workspaceLifecycle[Symbol.asyncIterator]();
      const terminalRuns = collectTerminalRuns(workspaceLifecycleIterator, 2);

      const accepted = await caller.sessionSendPromptAsync({
        sessionId: session.id,
        prompt: 'Explain async submit',
      });

      expect(accepted).toEqual({
        accepted: true,
        sessionId: session.id,
        workspaceId: activeWorkspace.id,
        runId: expect.any(String),
        acceptedAt: expect.any(String),
      });
      if (!('accepted' in accepted)) {
        throw new Error('Expected an accepted run.');
      }
      const firstRunEvents = await caller.sessionRunEvents({
        sessionId: session.id,
        runId: accepted.runId,
      });
      const firstRunItems = collectRunEvents(firstRunEvents);
      await expect(caller.sessionRunState({ id: session.id })).resolves.toMatchObject({
        running: true,
        activeRun: {
          runId: accepted.runId,
          acceptedAt: accepted.acceptedAt,
        },
      });
      await expect(caller.session({ id: session.id })).resolves.toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            text: 'Explain async submit',
            isPending: true,
          }),
        ]),
      });
      await expect(caller.sessionSendPromptAsync({
        sessionId: session.id,
        prompt: 'Second prompt',
      })).resolves.toMatchObject({
        queued: true,
        sessionId: session.id,
        position: 1,
      });
      await expect(caller.session({ id: session.id })).resolves.toMatchObject({
        queuedPrompts: [
          expect.objectContaining({
            prompt: 'Second prompt',
          }),
        ],
      });

      await vi.waitFor(async () => {
        await expect(caller.session({ id: session.id })).resolves.toMatchObject({
          messages: [
            expect.objectContaining({ text: 'Explain async submit' }),
            expect.objectContaining({ text: 'Mocked browser integration agent response: Explain async submit' }),
            expect.objectContaining({ text: 'Second prompt' }),
            expect.objectContaining({ text: 'Mocked browser integration agent response: Second prompt' }),
          ],
          queuedPrompts: [],
        });
      });

      await expect(caller.sessionRunState({ id: session.id })).resolves.toEqual({
        running: false,
        activeRun: null,
        pendingApproval: null,
      });
      await expect(firstRunItems).resolves.toEqual([
        expect.objectContaining({ kind: 'activity', runId: accepted.runId, sequence: 1 }),
        expect.objectContaining({ kind: 'result', runId: accepted.runId, sequence: 2 }),
      ]);
      const replay = await caller.sessionRunEvents({
        sessionId: session.id,
        runId: accepted.runId,
        afterSequence: 1,
      });
      await expect(collectRunEvents(replay)).resolves.toEqual([
        expect.objectContaining({ kind: 'result', runId: accepted.runId, sequence: 2 }),
      ]);
      const completed = await caller.session({ id: session.id });
      expect(completed?.messages.map((message) => message.text)).toEqual([
        'Explain async submit',
        'Mocked browser integration agent response: Explain async submit',
        'Second prompt',
        'Mocked browser integration agent response: Second prompt',
      ]);
      expect(completed?.queuedPrompts).toEqual([]);
      expect(completed?.messages.some((message) => message.isPending)).toBe(false);
      const runStarts = await startedRuns;
      expect(runStarts[0]?.run.runId).toBe(accepted.runId);
      expect(runStarts[1]?.run.runId).not.toBe(accepted.runId);
      const runTerminals = await terminalRuns;
      expect(runTerminals.map((event) => event.terminal.runId)).toEqual(
        runStarts.map((event) => event.run.runId),
      );
      expect(runTerminals.every((event) => event.terminal.kind === 'result')).toBe(true);
      await sessionLifecycleIterator.return?.();
      await workspaceLifecycleIterator.return?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates and deletes queued prompts through the control-plane API', async () => {
    vi.stubEnv('HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT', '1');
    vi.stubEnv('HEDDLE_BROWSER_INTEGRATION_FAKE_STREAM_PREVIEW_MS', '200');
    try {
      const { caller } = createControlPlaneCaller();
      const session = await caller.sessionCreate({ name: 'Queued edit session' });
      await caller.sessionSendPromptAsync({
        sessionId: session.id,
        prompt: 'First prompt',
      });
      const queued = await caller.sessionSendPromptAsync({
        sessionId: session.id,
        prompt: 'Queued before edit',
      });
      if (!('queued' in queued)) {
        throw new Error('Expected queued prompt result.');
      }

      await expect(caller.sessionQueuedPromptUpdate({
        sessionId: session.id,
        queueItemId: queued.queueItemId,
        prompt: 'Queued after edit',
      })).resolves.toMatchObject({
        queuedPrompts: [
          expect.objectContaining({ prompt: 'Queued after edit' }),
        ],
      });

      await expect(caller.sessionQueuedPromptDelete({
        sessionId: session.id,
        queueItemId: queued.queueItemId,
      })).resolves.toMatchObject({
        queuedPrompts: [],
      });

      await vi.waitFor(async () => {
        const completed = await caller.session({ id: session.id });
        expect(completed?.messages.map((message) => message.text)).toEqual([
          'First prompt',
          'Mocked browser integration agent response: First prompt',
        ]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles the accepted user message when an async run fails before a final answer', async () => {
    vi.spyOn(AgentLoopRuntimeService, 'run').mockRejectedValueOnce(new Error('loop failed'));
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Async failure session', apiKeyPresent: true });

    await expect(caller.sessionSendPromptAsync({
      sessionId: session.id,
      prompt: 'This run will fail',
      apiKey: 'test-api-key',
    })).resolves.toMatchObject({
      accepted: true,
      sessionId: session.id,
    });

    await vi.waitFor(async () => {
      await expect(caller.sessionRunState({ id: session.id })).resolves.toMatchObject({
        running: false,
      });
    });
    const failedSession = await caller.session({ id: session.id });
    expect(failedSession?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/^accepted-user-/),
        role: 'user',
        text: 'This run will fail',
        isPending: undefined,
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^accepted-run-error-/),
        role: 'assistant',
        text: 'Run failed before a final answer: loop failed',
      }),
    ]));
  });
});

async function collectRunEvents(
  events: AsyncIterable<ControlPlaneSessionRunEventEnvelope>,
): Promise<ControlPlaneSessionRunEventEnvelope[]> {
  const collected: ControlPlaneSessionRunEventEnvelope[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function collectStartedRuns(
  events: AsyncIterator<ControlPlaneSessionEventEnvelope>,
  count: number,
): Promise<Array<Extract<ControlPlaneSessionEventEnvelope, { type: 'session.run.updated' }>>> {
  const collected: Array<Extract<ControlPlaneSessionEventEnvelope, { type: 'session.run.updated' }>> = [];
  while (collected.length < count) {
    const next = await events.next();
    if (next.done) {
      throw new Error(`Session lifecycle stream ended after ${collected.length} run starts.`);
    }
    if (next.value.type === 'session.run.updated' && next.value.status === 'started') {
      collected.push(next.value);
    }
  }
  return collected;
}

async function collectTerminalRuns(
  events: AsyncIterator<ControlPlaneSessionsEventEnvelope>,
  count: number,
): Promise<Array<Extract<ControlPlaneSessionsEventEnvelope, { type: 'session.run.terminal' }>>> {
  const collected: Array<Extract<ControlPlaneSessionsEventEnvelope, { type: 'session.run.terminal' }>> = [];
  while (collected.length < count) {
    const next = await events.next();
    if (next.done) {
      throw new Error(`Workspace lifecycle stream ended after ${collected.length} run terminals.`);
    }
    if (next.value.type === 'session.run.terminal') {
      collected.push(next.value);
    }
  }
  return collected;
}

function createControlPlaneCaller() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-lifecycle-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
  const secondaryWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-lifecycle-secondary-'));
  const resolved = RuntimeWorkspaceService.createDescriptor({
    workspaceRoot,
    stateRoot,
    newWorkspaceRoot: secondaryWorkspaceRoot,
    workspaceStateRoot: join(secondaryWorkspaceRoot, '.heddle'),
    nextId: 'workspace-secondary',
    name: 'Secondary workspace',
    setActive: false,
  });
  const activeWorkspace = resolved.workspaces.find((workspace) => workspace.id === resolved.activeWorkspaceId);
  const secondaryWorkspace = resolved.workspaces.find((workspace) => workspace.id === 'workspace-secondary');
  if (!activeWorkspace) {
    throw new Error('expected active workspace');
  }
  if (!secondaryWorkspace) {
    throw new Error('expected secondary workspace');
  }

  const context: HeddleServerContext = {
    workspaceRoot,
    stateRoot,
    preferApiKey: false,
    activeWorkspaceId: activeWorkspace.id,
    activeWorkspace,
    workspaces: resolved.workspaces,
    requestAccess: createLocalHeddleServerRequestAccess(),
    runtimeHost: null,
    logger: pino({ level: 'silent' }),
  };
  const createEngineForWorkspace = (workspaceId: string) => {
    const workspace = resolved.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw new Error(`expected workspace: ${workspaceId}`);
    }

    return createWorkspaceEngine(workspace);
  };

  return {
    caller: controlPlaneRouter.createCaller(context),
    engine: createEngineForWorkspace(activeWorkspace.id),
    activeWorkspace,
    secondaryWorkspace,
    createEngineForWorkspace,
  };
}

function createWorkspaceEngine(workspace: WorkspaceDescriptor) {
  return createConversationEngine({
    workspaceRoot: workspace.workspaceRoot,
    stateRoot: workspace.stateRoot,
    sessionStoragePath: resolve(workspace.stateRoot, 'chat-sessions.catalog.json'),
    workspaceId: workspace.id,
    model: 'gpt-5.4',
    apiKeyPresent: true,
  });
}

function writeSkillSync(workspaceRoot: string, name: string, content: string): void {
  const skillRoot = join(workspaceRoot, '.agents', 'skills', name);
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(join(skillRoot, 'SKILL.md'), content, 'utf8');
}
