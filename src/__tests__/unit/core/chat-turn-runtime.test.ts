import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredProviderCredential } from '../../../core/auth/provider-credentials.js';
import { createChatSession, loadChatSessions, saveChatSessions } from '../../../core/chat/storage.js';
import {
  persistPreflightCompactionRunningSeed,
  persistPreparedChatSessionTurn,
} from '../../../core/chat/session-turn-preflight.js';
import { prepareOrdinaryChatTurnContext } from '../../../core/chat/turn-context.js';
import { loadChatTurnSession } from '../../../core/chat/turn-session.js';
import { resolveChatTurnModel, resolveChatTurnRuntime } from '../../../core/chat/turn-runtime.js';
import { DEFAULT_OPENAI_MODEL } from '../../../core/config.js';

describe('chat turn preparation modules', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads the requested session or preserves the existing missing-session error', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-session-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    saveChatSessions(sessionStoragePath, [session]);

    expect(loadChatTurnSession({ sessionStoragePath, sessionId: 'session-1' }).session.id).toBe('session-1');
    expect(() => loadChatTurnSession({ sessionStoragePath, sessionId: 'missing' })).toThrow(
      'Chat session not found: missing',
    );
  });

  it('resolves chat turn model precedence without changing defaults', () => {
    expect(resolveChatTurnModel({
      sessionModel: 'session-model',
      env: { OPENAI_MODEL: 'openai-env', ANTHROPIC_MODEL: 'anthropic-env' },
    })).toBe('session-model');
    expect(resolveChatTurnModel({
      env: { OPENAI_MODEL: 'openai-env', ANTHROPIC_MODEL: 'anthropic-env' },
    })).toBe('openai-env');
    expect(resolveChatTurnModel({
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: 'anthropic-env' },
    })).toBe('anthropic-env');
    expect(resolveChatTurnModel({
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
    })).toBe(DEFAULT_OPENAI_MODEL);
  });

  it('resolves explicit API-key runtime with memory context and credential source', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-runtime-'));
    const stateRoot = join(root, '.heddle');
    mkdirSync(join(stateRoot, 'memory'), { recursive: true });

    const runtime = resolveChatTurnRuntime({
      stateRoot,
      sessionModel: 'gpt-5.4',
      apiKey: 'explicit-key',
      systemContext: 'System context',
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
    });

    expect(runtime.model).toBe('gpt-5.4');
    expect(runtime.provider).toBe('openai');
    expect(runtime.apiKey).toBe('explicit-key');
    expect(runtime.providerCredentialSource).toEqual({ type: 'explicit-api-key' });
    expect(runtime.memoryDir).toBe(join(stateRoot, 'memory'));
    expect(runtime.systemContext).toContain('System context');
    expect(runtime.llm.info?.model).toBe('gpt-5.4');
  });

  it('preserves stored OAuth credential selection for OpenAI chat turns', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-oauth-'));
    const credentialStorePath = join(root, 'auth.json');
    const now = '2026-05-02T00:00:00.000Z';
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-05-02T01:00:00.000Z'),
      accountId: 'account-123',
      createdAt: now,
      updatedAt: now,
    }, credentialStorePath);

    const runtime = resolveChatTurnRuntime({
      stateRoot: join(root, '.heddle'),
      sessionModel: 'gpt-5.1-codex',
      credentialStorePath,
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
    });

    expect(runtime.apiKey).toBeUndefined();
    expect(runtime.providerCredentialSource).toEqual({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-123',
      expiresAt: Date.parse('2026-05-02T01:00:00.000Z'),
    });
  });

  it('preserves missing credential errors', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('PERSONAL_ANTHROPIC_API_KEY', '');
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-missing-'));

    expect(() => resolveChatTurnRuntime({
      stateRoot: join(root, '.heddle'),
      sessionModel: 'claude-sonnet-4-6',
      credentialStorePath: join(root, 'missing-auth.json'),
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
    })).toThrow('Missing Anthropic credential. Set ANTHROPIC_API_KEY for Anthropic models.');
  });

  it('prepares ordinary turn context with runtime, tool bundle, and default lease owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-context-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    saveChatSessions(sessionStoragePath, [session]);

    const context = prepareOrdinaryChatTurnContext({
      workspaceRoot: root,
      stateRoot: join(root, '.heddle'),
      sessionStoragePath,
      sessionId: 'session-1',
      apiKey: 'explicit-key',
    });

    expect(context.session.id).toBe('session-1');
    expect(context.runtime.model).toBe('gpt-5.4');
    expect(context.toolNames).toEqual([
      'list_files',
      'read_file',
      'edit_file',
      'delete_file',
      'move_file',
      'search_files',
      'web_search',
      'view_image',
      'list_memory_notes',
      'read_memory_note',
      'search_memory_notes',
      'memory_checkpoint',
      'record_knowledge',
      'update_plan',
      'run_shell_inspect',
      'run_shell_mutate',
    ]);
    expect(context.leaseOwner).toMatchObject({
      ownerKind: 'ask',
      clientLabel: 'another Heddle client',
    });
  });

  it('persists the preflight compaction-running context for the leased session', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-preflight-seed-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    const leasedSession = {
      ...session,
      history: [
        { role: 'user' as const, content: 'Earlier prompt' },
        { role: 'assistant' as const, content: 'Earlier answer' },
      ],
      lease: {
        ownerId: 'owner-1',
        ownerKind: 'ask' as const,
        clientLabel: 'test client',
        acquiredAt: '2026-05-03T00:00:00.000Z',
        lastSeenAt: '2026-05-03T00:00:00.000Z',
      },
    };
    saveChatSessions(sessionStoragePath, [leasedSession]);

    persistPreflightCompactionRunningSeed({
      sessionStoragePath,
      sessions: [leasedSession],
      sessionId: 'session-1',
      leasedSession,
      archivePath: '.heddle/chat-sessions/session-1/archives/archive-1.jsonl',
    });

    const nextSession = loadChatSessions(sessionStoragePath, true)[0];
    expect(nextSession?.context?.compactionStatus).toBe('running');
    expect(nextSession?.context?.lastArchivePath).toBe('.heddle/chat-sessions/session-1/archives/archive-1.jsonl');
    expect(nextSession?.lease).toEqual(leasedSession.lease);
  });

  it('persists prepared preflight session state before the run loop starts', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-preflight-persist-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    saveChatSessions(sessionStoragePath, [session]);

    const preparedSession = persistPreparedChatSessionTurn({
      sessionStoragePath,
      sessions: [session],
      session,
      prepared: {
        ok: true,
        preflightHistory: [
          { role: 'user', content: 'Earlier prompt' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        historyForRun: [
          { role: 'user', content: 'Earlier prompt' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        context: {
          estimatedHistoryTokens: 42,
          compactionStatus: 'idle',
        },
        archives: [],
      },
    });

    const persisted = loadChatSessions(sessionStoragePath, true)[0];
    expect(preparedSession.history).toHaveLength(2);
    expect(persisted?.history).toEqual(preparedSession.history);
    expect(persisted?.messages.map((message) => message.text)).toEqual(['Earlier prompt', 'Earlier answer']);
    expect(persisted?.context?.estimatedHistoryTokens).toBe(42);
  });
});
