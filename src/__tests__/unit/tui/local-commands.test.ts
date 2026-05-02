import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { autocompleteLocalCommand, getLocalCommandHints, isLikelyLocalCommand, runLocalCommand } from '../../../cli/chat/state/local-commands.js';
import { getStoredProviderCredential, setStoredProviderCredential } from '../../../core/auth/provider-credentials.js';

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

type TestChatSession = Parameters<typeof runLocalCommand>[0]['sessions'][number];

function testSession(overrides: Partial<TestChatSession> & Pick<TestChatSession, 'id' | 'name'>): TestChatSession {
  return {
    history: [],
    messages: [],
    turns: [],
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
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

  it('rejects unsupported OAuth model switching before updating the active model', async () => {
    const setActiveModel = vi.fn();
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/model gpt-5.4-pro',
      setActiveModel,
      providerCredentialSource: { type: 'oauth', provider: 'openai', accountId: 'acct', expiresAt: Date.now() + 60_000 },
    }));

    expect(setActiveModel).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      handled: true,
      kind: 'message',
    });
    if (!result.handled || result.kind !== 'message') {
      throw new Error('expected an OAuth incompatibility message');
    }
    expect(result.message).toContain('OpenAI account sign-in is not enabled for model gpt-5.4-pro');
  });

  it('allows switching sessions by recent-session index', async () => {
    const switchSession = vi.fn();
    const sessions = [
      testSession({ id: 'session-a', name: 'A' }),
      testSession({ id: 'session-b', name: 'B', createdAt: '2024-01-02', updatedAt: '2024-01-02' }),
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
      sessionId: 'session-b',
      message: 'Switched to session-b (B).\n0 turns • no turns yet',
    });
  });

  it('allows switching sessions by exact session id', async () => {
    const switchSession = vi.fn();
    const sessions = [
      testSession({ id: 'session-a', name: 'A' }),
      testSession({
        id: 'session-b',
        name: 'B',
        turns: [
          {
            id: 'turn-1',
            prompt: 'What changed?',
            outcome: 'done',
            summary: 'Summarized the change.',
            steps: 2,
            traceFile: '/tmp/trace.json',
            events: ['run finished: done'],
          },
        ],
        createdAt: '2024-01-02',
        updatedAt: '2024-01-02',
      }),
    ];

    const result = await runLocalCommand(createCommandArgs({
      prompt: '/session switch session-b',
      sessions,
      recentSessions: sessions,
      activeSessionId: 'session-a',
      switchSession,
    }));

    expect(switchSession).toHaveBeenCalledWith('session-b');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      sessionId: 'session-b',
      message: 'Switched to session-b (B).\n1 turns • What changed?',
    });
  });

  it('returns the created session id for /session new messages', async () => {
    const session = testSession({ id: 'session-new', name: 'New Session', createdAt: '2024-01-03', updatedAt: '2024-01-03' });
    const createSession = vi.fn(() => session);
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/session new New Session',
      createSession,
    }));

    expect(createSession).toHaveBeenCalledWith('New Session');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      sessionId: 'session-new',
      message: 'Created and switched to session-new (New Session).',
    });
  });

  it('allows continuing sessions by recent-session index', async () => {
    const sessions = [
      testSession({ id: 'session-a', name: 'A' }),
      testSession({ id: 'session-b', name: 'B', createdAt: '2024-01-02', updatedAt: '2024-01-02' }),
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

  it('renames the current session with the provided value', async () => {
    const renameSession = vi.fn();
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/session rename Focused Investigation',
      renameSession,
    }));

    expect(renameSession).toHaveBeenCalledWith('Focused Investigation');
    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'Renamed current session to Focused Investigation.',
    });
  });

  it('closes sessions by id and by recent-session index', async () => {
    const removeSession = vi.fn();
    const sessions = [
      testSession({ id: 'session-a', name: 'A' }),
      testSession({ id: 'session-b', name: 'B', createdAt: '2024-01-02', updatedAt: '2024-01-02' }),
    ];

    const byId = await runLocalCommand(createCommandArgs({
      prompt: '/session close session-a',
      sessions,
      recentSessions: sessions,
      removeSession,
    }));
    const byIndex = await runLocalCommand(createCommandArgs({
      prompt: '/session close 2',
      sessions,
      recentSessions: sessions,
      removeSession,
    }));

    expect(removeSession).toHaveBeenNthCalledWith(1, 'session-a');
    expect(removeSession).toHaveBeenNthCalledWith(2, 'session-b');
    expect(byId).toEqual({
      handled: true,
      kind: 'message',
      message: 'Closed session-a (A).',
    });
    expect(byIndex).toEqual({
      handled: true,
      kind: 'message',
      message: 'Closed session-b (B).',
    });
  });

  it('reports unknown sessions for switch, continue, and close commands', async () => {
    const sessions = [testSession({ id: 'session-a', name: 'A' })];

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/session switch missing',
      sessions,
      recentSessions: sessions,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Unknown session: missing. Use /session list to inspect available sessions.',
    });

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/session continue missing',
      sessions,
      recentSessions: sessions,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Unknown session: missing.\nUse /session list to inspect available sessions.',
    });

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/session close missing',
      sessions,
      recentSessions: sessions,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Unknown session: missing.\nUse /session list to inspect available sessions.',
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

  it('uses a host-unavailable message when TUI snapshot support is absent', async () => {
    const result = await runLocalCommand(createCommandArgs({
      prompt: '/debug tui-snapshot',
      saveTuiSnapshot: undefined,
    }));

    expect(result).toEqual({
      handled: true,
      kind: 'message',
      message: 'TUI snapshots are not available in this runtime.',
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

  it('shows auth status and supports OpenAI OAuth login from chat', async () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-chat-auth-')), 'auth.json');

    const emptyStatus = await runLocalCommand(createCommandArgs({
      prompt: '/auth status',
      credentialStorePath: storePath,
    }));
    expect(emptyStatus).toMatchObject({
      handled: true,
      kind: 'message',
    });
    if (!emptyStatus.handled || emptyStatus.kind !== 'message') {
      throw new Error('expected /auth status to return a message result');
    }
    expect(emptyStatus.message).toContain('Stored credentials: none');

    const login = await runLocalCommand(createCommandArgs({
      prompt: '/auth login openai',
      credentialStorePath: storePath,
      openAiLogin: async () => ({
        type: 'oauth',
        provider: 'openai',
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
        accountId: 'account-123',
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
        label: 'ChatGPT/Codex OAuth',
      }),
    }));
    expect(login).toMatchObject({
      handled: true,
      kind: 'message',
    });
    if (!login.handled || login.kind !== 'message') {
      throw new Error('expected /auth login openai to return a message result');
    }
    expect(login.message).toContain('Stored OpenAI OAuth credential.');
    expect(login.message).toContain('Account: account-123');
    expect(login.message).not.toContain('access-secret');
    expect(getStoredProviderCredential('openai', storePath)).toMatchObject({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-123',
    });
  });

  it('supports provider credential logout from chat', async () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-chat-auth-')), 'auth.json');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, storePath);

    const logout = await runLocalCommand(createCommandArgs({
      prompt: '/auth logout openai',
      credentialStorePath: storePath,
    }));

    expect(logout).toEqual({
      handled: true,
      kind: 'message',
      message: 'Removed stored openai credential.',
    });
    expect(getStoredProviderCredential('openai', storePath)).toBeUndefined();
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
    expect(hints).toContainEqual({
      command: '/auth login openai',
      description: 'sign in with OpenAI ChatGPT/Codex OAuth',
    });
  });

  it('autocompletes command roots and subcommands with tab-friendly spacing', () => {
    expect(autocompleteLocalCommand('/m', 'session-1', [])).toBe('/model ');
    expect(autocompleteLocalCommand('/model s', 'session-1', [])).toBe('/model set ');
    expect(autocompleteLocalCommand('/session sw', 'session-1', [])).toBe('/session switch ');
  });

  it('autocompletes shared prefixes while preserving leading whitespace', () => {
    expect(autocompleteLocalCommand('  /sess', 'session-1', [])).toBe('  /session ');
    expect(autocompleteLocalCommand('/hea', 'session-1', [])).toBe('/heartbeat ');
  });

  it('autocompletes concrete session switch targets from matching session ids', () => {
    const sessions = [
      testSession({ id: 'session-a', name: 'A' }),
      testSession({ id: 'session-b', name: 'B', createdAt: '2024-01-02', updatedAt: '2024-01-02' }),
    ];

    expect(autocompleteLocalCommand('/session switch session-a', 'session-a', sessions)).toBeUndefined();
    expect(autocompleteLocalCommand('/session switch s', 'session-a', sessions)).toBe('/session switch session-');
    expect(autocompleteLocalCommand('/session switch session-a', 'session-b', sessions)).toBeUndefined();
  });

  it('does not autocomplete non-commands or already-maximal ambiguous prefixes', () => {
    expect(autocompleteLocalCommand('hello', 'session-1', [])).toBeUndefined();
    expect(autocompleteLocalCommand('/heartbeat ', 'session-1', [])).toBeUndefined();
  });

  it('filters session switch hints and marks the active session', () => {
    const sessions = [
      testSession({ id: 'session-a', name: 'Alpha' }),
      testSession({ id: 'session-b', name: 'Beta', createdAt: '2024-01-02', updatedAt: '2024-01-02' }),
      testSession({ id: 'work-session', name: 'Work', createdAt: '2024-01-03', updatedAt: '2024-01-03' }),
    ];

    expect(getLocalCommandHints('/session switch session-', 'session-b', sessions)).toEqual([
      { command: '/session switch session-a', description: 'Alpha' },
      { command: '/session switch session-b', description: '(current) Beta' },
    ]);
  });

  it('falls back to all shared command hints when a partial slash command has no matching hint', () => {
    const hints = getLocalCommandHints('/drift maybe', 'session-1', []);

    expect(hints.length).toBeGreaterThan(5);
    expect(hints).toContainEqual({
      command: '/help',
      description: 'show available local commands',
    });
  });

  it('returns unknown command messages for recognized roots with unsupported subcommands', async () => {
    await expect(runLocalCommand(createCommandArgs({
      prompt: '/drift maybe',
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Unknown command: /drift maybe. Use /help for available commands.',
    });
  });

  it('passes through unknown slash roots as normal prompts', async () => {
    await expect(runLocalCommand(createCommandArgs({
      prompt: '/unknown do something',
    }))).resolves.toEqual({ handled: false });
  });

  it('reports empty session and heartbeat listings', async () => {
    const workspaceRoot = join(tmpdir(), `heddle-chat-empty-${Date.now()}`);
    const stateRoot = join(workspaceRoot, '.heddle');

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/session list',
      sessions: [],
      listRecentSessionsMessage: [],
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'No sessions available.',
    });

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/heartbeat tasks',
      workspaceRoot,
      stateRoot,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'No heartbeat tasks found.',
    });

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/heartbeat runs repo-check',
      workspaceRoot,
      stateRoot,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'No heartbeat runs found for task repo-check.',
    });
  });

  it('reports missing heartbeat task and run references', async () => {
    const workspaceRoot = join(tmpdir(), `heddle-chat-heartbeat-missing-${Date.now()}`);
    const stateRoot = join(workspaceRoot, '.heddle');

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/heartbeat task repo-check',
      workspaceRoot,
      stateRoot,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Heartbeat task not found: repo-check',
    });

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/heartbeat run repo-check latest',
      workspaceRoot,
      stateRoot,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Heartbeat run not found for task repo-check: latest',
    });

    await expect(runLocalCommand(createCommandArgs({
      prompt: '/heartbeat continue repo-check latest',
      workspaceRoot,
      stateRoot,
    }))).resolves.toEqual({
      handled: true,
      kind: 'message',
      message: 'Heartbeat run not found for task repo-check: latest',
    });
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
