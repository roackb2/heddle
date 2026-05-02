import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredProviderCredential } from '../../../core/auth/provider-credentials.js';
import { createChatSession, saveChatSessions } from '../../../core/chat/storage.js';
import { loadChatTurnSession } from '../../../core/chat/turn-session.js';
import { resolveChatTurnModel, resolveChatTurnRuntime } from '../../../core/chat/turn-runtime.js';
import { createChatTurnTools, listChatTurnToolNames } from '../../../core/chat/turn-tools.js';
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

  it('creates the ordinary chat turn tool bundle with the plan tool included', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-tools-'));
    const tools = createChatTurnTools({
      model: 'gpt-5.4',
      apiKey: 'explicit-key',
      providerCredentialSource: { type: 'explicit-api-key' },
      workspaceRoot: root,
      memoryDir: join(root, '.heddle', 'memory'),
    });

    expect(listChatTurnToolNames(tools)).toEqual([
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
  });
});
