import { describe, expect, it, vi } from 'vitest';
import { createSlashCommandRegistry } from '../../../core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '../../../core/commands/slash/modules/core-command-modules.js';
import { buildHeartbeatContinuationPrompt } from '../../../core/commands/slash/modules/heartbeat/heartbeat-commands.js';
import { resolveSessionReference } from '../../../core/commands/slash/modules/session/session-commands.js';
import type { ChatSession } from '../../../core/chat/types.js';
import type { SlashCommandExecutionContext } from '../../../core/commands/slash/modules/context.js';
import type { HeartbeatTask, HeartbeatTaskRunRecordEntry } from '../../../core/runtime/heartbeat-task-store.js';

function testSession(overrides: Partial<ChatSession> & Pick<ChatSession, 'id' | 'name'>): ChatSession {
  return {
    history: [],
    messages: [],
    turns: [],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

function testHeartbeatTask(overrides: Partial<HeartbeatTask> & Pick<HeartbeatTask, 'id'>): HeartbeatTask {
  return {
    task: 'Check repository state',
    enabled: true,
    intervalMs: 60_000,
    ...overrides,
  };
}

function testHeartbeatRun(overrides: Partial<HeartbeatTaskRunRecordEntry> = {}): HeartbeatTaskRunRecordEntry {
  const task = testHeartbeatTask({
    id: 'repo-check',
    status: 'waiting',
    lastProgress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
    resumable: true,
  });
  return {
    id: '2026-04-14T00-00-00.000Z-repo-check',
    path: '/tmp/run.json',
    taskId: 'repo-check',
    runId: 'run_heartbeat_1',
    createdAt: '2026-04-14T00:00:00.000Z',
    record: {
      task,
      loadedCheckpoint: true,
      result: {
        decision: 'continue',
        summary: 'Checked the repository and found one safe next step.\n\nHEARTBEAT_DECISION: continue',
        checkpoint: {
          version: 1,
          runId: 'run_heartbeat_1',
          createdAt: '2026-04-14T00:00:00.000Z',
          state: {
            status: 'finished',
            runId: 'run_heartbeat_1',
            goal: 'Heartbeat wake cycle',
            model: 'gpt-5.4',
            provider: 'openai',
            workspaceRoot: '/tmp/workspace',
            startedAt: '2026-04-13T23:59:00.000Z',
            finishedAt: '2026-04-14T00:00:00.000Z',
            outcome: 'done',
            summary: 'Checked the repository and found one safe next step.\n\nHEARTBEAT_DECISION: continue',
            transcript: [],
            trace: [],
          },
        },
        state: {
          status: 'finished',
          runId: 'run_heartbeat_1',
          goal: 'Heartbeat wake cycle',
          model: 'gpt-5.4',
          provider: 'openai',
          workspaceRoot: '/tmp/workspace',
          startedAt: '2026-04-13T23:59:00.000Z',
          finishedAt: '2026-04-14T00:00:00.000Z',
          outcome: 'done',
          summary: 'Checked the repository and found one safe next step.\n\nHEARTBEAT_DECISION: continue',
          transcript: [],
          trace: [],
        },
      },
    },
    ...overrides,
  };
}

function createContext(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  let activeModel = 'gpt-5.4';
  let driftEnabled = false;
  const sessions = [
    testSession({ id: 'session-a', name: 'Alpha' }),
    testSession({ id: 'session-b', name: 'Beta', updatedAt: '2024-01-02' }),
  ];

  return {
    model: {
      active: () => activeModel,
      setActive: (model) => {
        activeModel = model;
      },
      credentialSource: () => undefined,
    },
    auth: {
      status: () => 'Auth store: test\nStored credentials: none',
      login: async (provider) => `Logged in ${provider}`,
      logout: (provider) => `Logged out ${provider}`,
    },
    compaction: {
      compactActive: () => 'Compacted history.',
    },
    drift: {
      status: () => ({ enabled: driftEnabled }),
      setEnabled: (enabled) => {
        driftEnabled = enabled;
      },
    },
    session: {
      all: () => sessions,
      recent: () => [...sessions].reverse(),
      recentListMessage: () => ['1. Beta (session-b)', '2. Alpha (session-a)'],
      create: (name) => testSession({ id: 'session-new', name: name ?? 'New session' }),
      switch: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      summarize: (session) => `Summary for ${session.id}`,
    },
    heartbeat: {
      listTasks: async () => [],
      listRunRecords: async () => [],
      loadRunRecord: async () => undefined,
    },
    ...overrides,
  };
}

describe('core slash command modules', () => {
  const registry = createSlashCommandRegistry(createCoreSlashCommandModules());

  it('runs model commands through the registry and preserves compatibility aliases', async () => {
    const context = createContext();

    await expect(registry.run(context, '/model')).resolves.toMatchObject({
      kind: 'message',
      message: 'Current model: gpt-5.4',
    });
    await expect(registry.run(context, '/models')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('Common built-in model choices'),
    });
    await expect(registry.run(context, '/model gpt-5.4-mini')).resolves.toMatchObject({
      kind: 'message',
      message: 'Switched model to gpt-5.4-mini',
    });
    await expect(registry.run(context, '/model')).resolves.toMatchObject({
      message: 'Current model: gpt-5.4-mini',
    });
  });

  it('uses shared model credential policy before switching models', async () => {
    const setActive = vi.fn();
    const context = createContext({
      model: {
        active: () => 'gpt-5.4',
        setActive,
        credentialSource: () => ({
          type: 'oauth',
          provider: 'openai',
          accountId: 'acct',
          expiresAt: Date.now() + 60_000,
        }),
      },
    });

    await expect(registry.run(context, '/model gpt-5.4-pro')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('OpenAI account sign-in is not enabled for model gpt-5.4-pro'),
    });
    expect(setActive).not.toHaveBeenCalled();
  });

  it('routes auth, compaction, and drift commands through host ports', async () => {
    const context = createContext();

    await expect(registry.run(context, '/auth login openai')).resolves.toMatchObject({
      message: 'Logged in openai',
    });
    await expect(registry.run(context, '/compact')).resolves.toMatchObject({
      message: 'Compacted history.',
    });
    await expect(registry.run(context, '/drift on')).resolves.toMatchObject({
      message: expect.stringContaining('Enabled CyberLoop semantic drift detection'),
    });
    await expect(registry.run(context, '/drift status')).resolves.toMatchObject({
      message: expect.stringContaining('CyberLoop drift detection is enabled'),
    });
  });

  it('publishes module-owned help hints for host command surfaces', () => {
    expect(registry.hints()).toEqual(expect.arrayContaining([
      { command: '/model <name>', description: 'switch the current model' },
      { command: '/auth login openai', description: 'sign in with OpenAI ChatGPT/Codex OAuth' },
      { command: '/compact', description: 'compact earlier session history for the next run' },
      { command: '/drift', description: 'show CyberLoop semantic drift detection status' },
      { command: '/session switch <id>', description: 'switch to another session' },
      { command: '/heartbeat continue <task> [run-id|latest]', description: 'continue in chat from a heartbeat run summary' },
    ]));
  });

  it('routes session commands through host ports', async () => {
    const clear = vi.fn();
    const switchSession = vi.fn();
    const rename = vi.fn();
    const remove = vi.fn();
    const context = createContext({
      session: {
        ...createContext().session,
        clear,
        switch: switchSession,
        rename,
        remove,
      },
    });

    await expect(registry.run(context, '/clear')).resolves.toMatchObject({
      kind: 'message',
      message: 'Cleared the current chat transcript.',
    });
    expect(clear).toHaveBeenCalledTimes(1);

    await expect(registry.run(context, '/session switch session-a')).resolves.toMatchObject({
      kind: 'message',
      sessionId: 'session-a',
      message: 'Switched to session-a (Alpha).\nSummary for session-a',
    });
    expect(switchSession).toHaveBeenCalledWith('session-a');

    await expect(registry.run(context, '/session continue 1')).resolves.toMatchObject({
      kind: 'continue',
      sessionId: 'session-b',
      message: 'Switched to session-b (Beta).\nContinuing from that session transcript.',
    });

    await expect(registry.run(context, '/session rename Focus')).resolves.toMatchObject({
      kind: 'message',
      message: 'Renamed current session to Focus.',
    });
    expect(rename).toHaveBeenCalledWith('Focus');

    await expect(registry.run(context, '/session close 2')).resolves.toMatchObject({
      kind: 'message',
      message: 'Closed session-a (Alpha).',
    });
    expect(remove).toHaveBeenCalledWith('session-a');
  });

  it('leaves required-argument session commands unmatched without an argument', () => {
    expect(registry.find('/session switch')).toBeUndefined();
    expect(registry.find('/session continue')).toBeUndefined();
    expect(registry.find('/session rename')).toBeUndefined();
    expect(registry.find('/session close')).toBeUndefined();
    expect(registry.find('/session new')?.command.id).toBe('session.new');
  });

  it('resolves session references by exact id before recent-session index', () => {
    const sessions = [
      testSession({ id: '1', name: 'Literal One' }),
      testSession({ id: 'session-b', name: 'Beta' }),
    ];
    const recentSessions = [
      testSession({ id: 'recent-1', name: 'Recent One' }),
      sessions[1]!,
    ];

    expect(resolveSessionReference({ sessions, recentSessions, value: '1' })?.id).toBe('1');
    expect(resolveSessionReference({ sessions, recentSessions, value: '2' })?.id).toBe('session-b');
    expect(resolveSessionReference({ sessions, recentSessions, value: 'missing' })).toBeUndefined();
  });

  it('routes heartbeat commands through host ports', async () => {
    const task = testHeartbeatTask({
      id: 'repo-check',
      status: 'waiting',
      nextRunAt: '2026-04-14T00:00:00.000Z',
      lastDecision: 'continue',
      lastProgress: 'Heartbeat wake finished.',
    });
    const run = testHeartbeatRun();
    const context = createContext({
      heartbeat: {
        listTasks: async () => [task],
        listRunRecords: async (options) => options?.taskId === 'repo-check' ? [run] : [],
        loadRunRecord: async (id) => id === run.id ? run : undefined,
      },
    });

    await expect(registry.run(context, '/heartbeat tasks')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('enabled repo-check'),
    });
    await expect(registry.run(context, '/heartbeat task repo-check')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('Task:\nCheck repository state'),
    });
    await expect(registry.run(context, '/heartbeat runs repo-check')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('summary=Checked the repository and found one safe next step.'),
    });
    await expect(registry.run(context, '/heartbeat run repo-check latest')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('Heartbeat run 2026-04-14T00-00-00.000Z-repo-check'),
    });
    await expect(registry.run(context, '/heartbeat continue repo-check latest')).resolves.toMatchObject({
      kind: 'execute',
      displayText: 'Continue heartbeat repo-check',
      prompt: expect.stringContaining('Heartbeat task id: repo-check'),
    });
  });

  it('keeps heartbeat continuation prompt formatting pure', () => {
    const prompt = buildHeartbeatContinuationPrompt(testHeartbeatRun());

    expect(prompt).toContain('Heartbeat run id: run_heartbeat_1');
    expect(prompt).toContain('Task progress: Heartbeat wake finished.');
    expect(prompt).toContain('Checked the repository and found one safe next step.');
    expect(prompt).not.toContain('HEARTBEAT_DECISION');
  });
});
