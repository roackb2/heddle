import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { autocompleteLocalCommand, getLocalCommandHints, isLikelyLocalCommand, runLocalCommand } from '../../cli/chat/state/local-commands.js';

function createCommandArgs(overrides: Partial<Parameters<typeof runLocalCommand>[0]> = {}): Parameters<typeof runLocalCommand>[0] {
  return {
    prompt: '/help',
    activeModel: 'gpt-5.1-codex',
    setActiveModel: vi.fn(),
    sessions: [],
    recentSessions: [],
    activeSessionId: 'session-1',
    switchSession: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    removeSession: vi.fn(),
    clearConversation: vi.fn(),
    compactConversation: vi.fn(() => 'Compacted earlier session history to reduce context size.'),
    driftEnabled: false,
    setDriftEnabled: vi.fn(),
    listRecentSessionsMessage: [],
    workspaceRoot: '/tmp/workspace',
    stateRoot: '/tmp/workspace/.heddle',
    ...overrides,
  };
}

describe('runLocalCommand', () => {
  it('treats bare and partial slash command roots as local commands for hints', () => {
    expect(isLikelyLocalCommand('/')).toBe(true);
    expect(isLikelyLocalCommand('/h')).toBe(true);
    expect(isLikelyLocalCommand('/mo')).toBe(true);
    expect(isLikelyLocalCommand('/sess')).toBe(true);
    expect(isLikelyLocalCommand('/comp')).toBe(true);
  });

  it('does not treat absolute unix paths as slash commands', () => {
    expect(isLikelyLocalCommand('/Users/roackb2/Desktop/screenshot.png')).toBe(false);
  });

  it('lists grouped common built-in model choices with multi-line formatting', async () => {
    const result = await runLocalCommand(createCommandArgs({ prompt: '/model list' }));

    expect(result).toMatchObject({
      handled: true,
      kind: 'message',
    });
    if (!result.handled || result.kind !== 'message') {
      throw new Error('expected /model list to return a message result');
    }
    expect(result.message).toContain('Common built-in model choices');
    expect(result.message).toContain('OpenAI · GPT-5.5\n  - gpt-5.5\n  - gpt-5.5-pro');
    expect(result.message).toContain('OpenAI · GPT-5.4\n  - gpt-5.4\n  - gpt-5.4-pro\n  - gpt-5.4-mini\n  - gpt-5.4-nano');
    expect(result.message).toContain('OpenAI · GPT-4.1\n  - gpt-4.1\n  - gpt-4.1-mini\n  - gpt-4.1-nano');
    expect(result.message).toContain('Anthropic · Claude 4\n  - claude-opus-4-6\n  - claude-sonnet-4-6\n  - claude-haiku-4-5');
    expect(result.message).toContain('Anthropic · Earlier Claude 4\n  - claude-opus-4-1\n  - claude-opus-4-0\n  - claude-sonnet-4-0');
    expect(result.message).toContain('Anthropic · Claude 3.5\n  - claude-3-5-sonnet-latest\n  - claude-3-5-haiku-latest');
  });

  it('keeps /models as a compatibility alias for /model list', async () => {
    const result = await runLocalCommand(createCommandArgs({ prompt: '/models' }));

    expect(result).toMatchObject({
      handled: true,
      kind: 'message',
    });
    if (!result.handled || result.kind !== 'message') {
      throw new Error('expected /models to return a message result');
    }
    expect(result.message).toContain('Common built-in model choices');
    expect(result.message).toContain('OpenAI · GPT-5.5\n  - gpt-5.5');
    expect(result.message).toContain('OpenAI · GPT-5.4\n  - gpt-5.4');
    expect(result.message).toContain('Anthropic · Claude 4\n  - claude-opus-4-6');
  });

  it('recognizes supported shortlist models when switching', async () => {
    const setActiveModel = vi.fn();
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/model gpt-5.4-mini',
      setActiveModel,
    }));

    expect(setActiveModel).toHaveBeenCalledWith('gpt-5.4-mini');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Switched model to gpt-5.4-mini',
    });
  });

  it('does not treat /model set as a literal model name', async () => {
    const setActiveModel = vi.fn();
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/model set',
      setActiveModel,
    }));

    expect(setActiveModel).not.toHaveBeenCalled();
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Use /model set <query> to filter models, then use arrows and Enter to choose one.',
    });
  });

  it('allows switching sessions by recent-session index', async () => {
    const switchSession = vi.fn();
    const sessions = [
      { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
    ];
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/session switch 2',
      sessions,
      recentSessions: sessions,
      activeSessionId: 'session-a',
      switchSession,
    }));

    expect(switchSession).toHaveBeenCalledWith('session-b');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Switched to session-b (B).\n0 turns • no turns yet',
    });
  });

  it('allows continuing sessions by recent-session index', async () => {
    const sessions = [
      { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
    ];
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/session continue 2',
      sessions,
      recentSessions: sessions,
      activeSessionId: 'session-a',
    }));

    expect(result).toEqual({
      handled: true,
      kind: 'continue',
      sessionId: 'session-b',
      message: 'Switched to session-b (B).\nContinuing from that session transcript.',
    });
  });

  it('passes through absolute unix paths as normal prompts', async () => {
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/Users/roackb2/Desktop/screenshot.png can you describe this image',
    }));

    expect(result).toEqual({ handled: false });
  });

  it('runs manual compaction when requested', async () => {
    const compactConversation = vi.fn(
      () => 'Compacted earlier session history to reduce context size (24 messages summarized).',
    );
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/compact',
      activeModel: 'claude-sonnet-4-6',
      compactConversation,
    }));

    expect(compactConversation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Compacted earlier session history to reduce context size (24 messages summarized).',
    });
  });

  it('saves a TUI snapshot when requested', async () => {
    const saveTuiSnapshot = vi.fn(
      () =>
        'Saved TUI snapshot at 2026-04-21T00:00:00.000Z.\n'
        + 'Text: /tmp/snapshot.txt\n'
        + 'ANSI: /tmp/snapshot.ansi\n'
        + 'Metadata: /tmp/snapshot.json',
    );

    const result = await runLocalCommand(createCommandArgs({
      prompt: '/debug tui-snapshot',
      saveTuiSnapshot,
    }));

    expect(saveTuiSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message:
        'Saved TUI snapshot at 2026-04-21T00:00:00.000Z.\n'
        + 'Text: /tmp/snapshot.txt\n'
        + 'ANSI: /tmp/snapshot.ansi\n'
        + 'Metadata: /tmp/snapshot.json',
    });
  });

  it('toggles drift detection commands', async () => {
    const setDriftEnabled = vi.fn();
    const enabled = await runLocalCommand(createCommandArgs({
      prompt: '/drift on',
      setDriftEnabled,
    }));
    const status = await runLocalCommand(createCommandArgs({
      prompt: '/drift',
      driftEnabled: true,
      setDriftEnabled,
    }));
    const disabled = await runLocalCommand(createCommandArgs({
      prompt: '/drift off',
      driftEnabled: true,
      setDriftEnabled,
    }));

    expect(setDriftEnabled).toHaveBeenNthCalledWith(1, true);
    expect(setDriftEnabled).toHaveBeenNthCalledWith(2, false);
    expect(enabled).toMatchObject({ handled: true, kind: 'message' });
    expect(status).toMatchObject({ handled: true, kind: 'message' });
    expect(disabled).toMatchObject({ handled: true, kind: 'message' });
    if (status.handled && status.kind === 'message') {
      expect(status.message).toContain('CyberLoop drift detection is enabled');
    }
  });

  it('includes /compact and /drift in shared slash-command hints', () => {
    const hints = getLocalCommandHints('/', 'session-1', []);

    expect(hints).toContainEqual({
      command: '/compact',
      description: 'compact earlier session history for the next run',
    });
    expect(hints).toContainEqual({
      command: '/drift',
      description: 'show CyberLoop semantic drift detection status',
    });
    expect(hints).toContainEqual({
      command: '/debug tui-snapshot',
      description: 'save the latest rendered TUI frame for inspection',
    });
  });

  it('autocompletes command roots and subcommands with tab-friendly spacing', () => {
    expect(autocompleteLocalCommand('/m', 'session-1', [])).toBe('/model ');
    expect(autocompleteLocalCommand('/model s', 'session-1', [])).toBe('/model set ');
    expect(autocompleteLocalCommand('/session sw', 'session-1', [])).toBe('/session switch ');
  });

  it('autocompletes concrete session switch targets from matching session ids', () => {
    const sessions = [
      { id: 'session-a', name: 'A', history: [], messages: [], turns: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'session-b', name: 'B', history: [], messages: [], turns: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
    ];

    expect(autocompleteLocalCommand('/session switch session-a', 'session-a', sessions)).toBeUndefined();
    expect(autocompleteLocalCommand('/session switch s', 'session-a', sessions)).toBe('/session switch session-');
    expect(autocompleteLocalCommand('/session switch session-a', 'session-b', sessions)).toBeUndefined();
  });

  it('does not autocomplete non-commands or already-maximal ambiguous prefixes', () => {
    expect(autocompleteLocalCommand('hello', 'session-1', [])).toBeUndefined();
    expect(autocompleteLocalCommand('/heartbeat ', 'session-1', [])).toBeUndefined();
  });

  it('lists heartbeat tasks and can continue from the latest run', async () => {
    const workspaceRoot = join(tmpdir(), `heddle-chat-heartbeat-${Date.now()}`);
    mkdirSync(workspaceRoot, { recursive: true });
    const stateRoot = join(workspaceRoot, '.heddle');
    const heartbeatRoot = join(stateRoot, 'heartbeat');
    mkdirSync(join(heartbeatRoot, 'tasks'), { recursive: true });
    mkdirSync(join(heartbeatRoot, 'runs'), { recursive: true });

    writeFileSync(join(heartbeatRoot, 'tasks', 'repo-check.json'), JSON.stringify({
      id: 'repo-check',
      task: 'Check repository state',
      enabled: true,
      status: 'waiting',
      intervalMs: 60_000,
      nextRunAt: '2026-04-14T00:00:00.000Z',
      lastDecision: 'continue',
      lastProgress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
      lastRunId: 'run_heartbeat_1',
      lastLoadedCheckpoint: true,
      resumable: true,
      lastUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        requests: 1,
      },
    }, null, 2));
    writeFileSync(join(heartbeatRoot, 'runs', '2026-04-14T00-00-00.000Z-repo-check.json'), JSON.stringify({
      task: {
        id: 'repo-check',
        task: 'Check repository state',
        enabled: true,
        status: 'waiting',
        lastProgress: 'Heartbeat wake finished. Waiting until the next scheduled run in 1m.',
        resumable: true,
        intervalMs: 60_000,
      },
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
            model: 'gpt-5.1-codex-mini',
            provider: 'openai',
            workspaceRoot,
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
          model: 'gpt-5.1-codex-mini',
          provider: 'openai',
          workspaceRoot,
          startedAt: '2026-04-13T23:59:00.000Z',
          finishedAt: '2026-04-14T00:00:00.000Z',
          outcome: 'done',
          summary: 'Checked the repository and found one safe next step.\n\nHEARTBEAT_DECISION: continue',
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            requests: 1,
          },
          transcript: [],
          trace: [],
        },
      },
    }, null, 2));

    const tasksResult = await runLocalCommand(createCommandArgs({
      prompt: '/heartbeat tasks',
      workspaceRoot,
      stateRoot,
    }));
    expect(tasksResult).toMatchObject({ handled: true, kind: 'message' });
    if (!tasksResult.handled || tasksResult.kind !== 'message') {
      throw new Error('expected /heartbeat tasks to return a message result');
    }
    expect(tasksResult.message).toContain('enabled repo-check');
    expect(tasksResult.message).toContain('status=waiting');
    expect(tasksResult.message).toContain('progress=Heartbeat wake finished.');

    const continueResult = await runLocalCommand(createCommandArgs({
      prompt: '/heartbeat continue repo-check latest',
      workspaceRoot,
      stateRoot,
    }));
    expect(continueResult).toMatchObject({ handled: true, kind: 'execute', displayText: 'Continue heartbeat repo-check' });
    if (!continueResult.handled || continueResult.kind !== 'execute') {
      throw new Error('expected /heartbeat continue to return an execute result');
    }
    expect(continueResult.prompt).toContain('Heartbeat task id: repo-check');
    expect(continueResult.prompt).toContain('Task progress: Heartbeat wake finished. Waiting until the next scheduled run in 1m.');
    expect(continueResult.prompt).toContain('Checked the repository and found one safe next step.');
  });
});
