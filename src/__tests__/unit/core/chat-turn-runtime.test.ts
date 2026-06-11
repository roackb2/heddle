import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialRepository } from '../../../core/auth/index.js';
import { ChatSessionRecords } from '../../../core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';
import { ConversationTurnPreflightService } from '../../../core/chat/engine/turns/preflight/index.js';
import { ConversationTurnContextBuilder } from '../../../core/chat/engine/turns/context/index.js';
import { ConversationTurnRuntimeResolver } from '../../../core/chat/engine/turns/runtime/index.js';
import { DEFAULT_OPENAI_MODEL } from '../../../core/config.js';
import { BROWSER_AUTOMATION_SKILL_NAME, FileAgentSkillActivationRepository } from '../../../core/skills/index.js';

describe('chat turn preparation modules', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads the requested session or preserves the existing missing-session error', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-session-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([session]);

    expect(ConversationTurnContextBuilder.build({
      workspaceRoot: root,
      stateRoot: join(root, '.heddle'),
      sessionStoragePath,
      sessionId: 'session-1',
      apiKey: 'explicit-key',
    }).session.id).toBe('session-1');
    expect(() => ConversationTurnContextBuilder.build({
      workspaceRoot: root,
      stateRoot: join(root, '.heddle'),
      sessionStoragePath,
      sessionId: 'missing',
      apiKey: 'explicit-key',
    })).toThrow('Chat session not found: missing');
  });

  it('resolves chat turn model precedence without changing defaults', () => {
    expect(ConversationTurnRuntimeResolver.resolveModel({
      sessionModel: 'session-model',
      env: { OPENAI_MODEL: 'openai-env', ANTHROPIC_MODEL: 'anthropic-env' },
    })).toBe('session-model');
    expect(ConversationTurnRuntimeResolver.resolveModel({
      env: { OPENAI_MODEL: 'openai-env', ANTHROPIC_MODEL: 'anthropic-env' },
    })).toBe('openai-env');
    expect(ConversationTurnRuntimeResolver.resolveModel({
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: 'anthropic-env' },
    })).toBe('anthropic-env');
    expect(ConversationTurnRuntimeResolver.resolveModel({
      env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
    })).toBe(DEFAULT_OPENAI_MODEL);
  });

  it('resolves explicit API-key runtime with memory context and credential source', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-runtime-'));
    const stateRoot = join(root, '.heddle');
    mkdirSync(join(stateRoot, 'memory'), { recursive: true });

    const runtime = ConversationTurnRuntimeResolver.resolve({
      config: {
        stateRoot,
        apiKey: 'explicit-key',
        systemContext: 'System context',
        env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
      },
      session: { model: 'gpt-5.4' },
    });

    expect(runtime.model).toBe('gpt-5.4');
    expect(runtime.provider).toBe('openai');
    expect(runtime.apiKey).toBe('explicit-key');
    expect(runtime.providerCredentialSource).toEqual({ type: 'explicit-api-key' });
    expect(runtime.memoryDir).toBe(join(stateRoot, 'memory'));
    expect(runtime.systemContext).toContain('System context');
    expect(runtime.systemContext).toContain('## Situation Awareness Domain');
    expect(runtime.systemContext).toContain('you MUST call project_dashboard before deeper repo inspection or explanation');
    expect(runtime.systemContext).toContain('## Heddle-Managed Memory Domain');
    expect(runtime.systemContext?.indexOf('## Situation Awareness Domain')).toBeLessThan(
      runtime.systemContext?.indexOf('## Heddle-Managed Memory Domain') ?? Infinity,
    );
    expect(runtime.llm.info?.model).toBe('gpt-5.4');
  });

  it('carries stored session reasoning effort into the turn runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-reasoning-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([session]);

    const context = ConversationTurnContextBuilder.build({
      workspaceRoot: root,
      stateRoot: join(root, '.heddle'),
      sessionStoragePath,
      sessionId: 'session-1',
      apiKey: 'explicit-key',
    });

    expect(context.runtime.reasoningEffort).toBe('medium');
  });

  it('preserves stored OAuth credential selection for OpenAI chat turns', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-oauth-'));
    const credentialStorePath = join(root, 'auth.json');
    const now = '2026-05-02T00:00:00.000Z';
    new ProviderCredentialRepository({ storePath: credentialStorePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-05-02T01:00:00.000Z'),
      accountId: 'account-123',
      createdAt: now,
      updatedAt: now,
    });

    const runtime = ConversationTurnRuntimeResolver.resolve({
      config: {
        stateRoot: join(root, '.heddle'),
        credentialStorePath,
        env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
      },
      session: { model: 'gpt-5.1-codex' },
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

    expect(() => ConversationTurnRuntimeResolver.resolve({
      config: {
        stateRoot: join(root, '.heddle'),
        credentialStorePath: join(root, 'missing-auth.json'),
        env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
      },
      session: { model: 'claude-sonnet-4-6' },
    })).toThrow('Missing Anthropic credential. Set ANTHROPIC_API_KEY for Anthropic models.');
  });

  it('resolves Ollama chat turns as local endpoint runtime without hosted credentials', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    vi.stubEnv('OLLAMA_OPENAI_BASE_URL', 'http://localhost:11434/v1');
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-ollama-'));

    const runtime = ConversationTurnRuntimeResolver.resolve({
      config: {
        stateRoot: join(root, '.heddle'),
        env: { OPENAI_MODEL: undefined, ANTHROPIC_MODEL: undefined },
      },
      session: { model: 'ollama/llama3.2:latest' },
    });

    expect(runtime.model).toBe('ollama/llama3.2:latest');
    expect(runtime.provider).toBe('ollama');
    expect(runtime.apiKey).toBeUndefined();
    expect(runtime.providerCredentialSource).toEqual({
      type: 'local-endpoint',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(runtime.llm.info).toMatchObject({
      provider: 'ollama',
      model: 'ollama/llama3.2:latest',
    });
  });

  it('prepares ordinary turn context with runtime, tool bundle, and default lease owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-context-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([session]);

    const context = ConversationTurnContextBuilder.build({
      workspaceRoot: root,
      stateRoot: join(root, '.heddle'),
      sessionStoragePath,
      sessionId: 'session-1',
      apiKey: 'explicit-key',
    });

    expect(context.session.id).toBe('session-1');
    expect(context.runtime.model).toBe('gpt-5.4');
    expect(context.toolNames).toEqual([
      'read_agent_skill',
      'project_dashboard',
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

  it('adds browser tools to future turns when Browser Automation is enabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-browser-automation-'));
    const stateRoot = join(root, '.heddle');
    const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([session]);
    new FileAgentSkillActivationRepository({ stateRoot }).write({
      version: 1,
      skills: {
        [BROWSER_AUTOMATION_SKILL_NAME]: {
          name: BROWSER_AUTOMATION_SKILL_NAME,
          status: 'active',
          source: 'built-in',
          skillFilePath: 'heddle://built-in-skills/browser-automation/SKILL.md',
          activatedAt: '2026-06-09T00:00:00.000Z',
          updatedAt: '2026-06-09T00:00:00.000Z',
        },
      },
    });

    const context = ConversationTurnContextBuilder.build({
      workspaceRoot: root,
      stateRoot,
      sessionStoragePath,
      sessionId: 'session-1',
      apiKey: 'explicit-key',
    });

    expect(context.toolNames).toEqual(expect.arrayContaining([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_screenshot',
      'browser_close',
    ]));
  });

  it('persists the preflight compaction-running context for the leased session', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-preflight-seed-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
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
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([leasedSession]);

    ConversationTurnPreflightService.persistRunningSeed({
      sessionStoragePath,
      sessions: [leasedSession],
      sessionId: 'session-1',
      leasedSession,
      archivePath: '.heddle/chat-sessions/session-1/archives/archive-1.jsonl',
    });

    const nextSession = new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).list()[0];
    expect(nextSession?.context?.compaction?.status).toBe('running');
    expect(nextSession?.context?.archive?.lastArchivePath).toBe('.heddle/chat-sessions/session-1/archives/archive-1.jsonl');
    expect(nextSession?.lease).toEqual(leasedSession.lease);
  });

  it('persists prepared preflight session state before the run loop starts', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-preflight-persist-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([session]);

    const preparedSession = ConversationTurnPreflightService.persistPrepared({
      sessionStoragePath,
      sessions: [session],
      session,
      compacted: {
        history: [
          { role: 'user', content: 'Earlier prompt' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        context: {
          estimatedHistoryTokens: 42,
          compaction: { status: 'idle' },
        },
        archive: {
          archives: [],
        },
      },
    });

    const persisted = new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).list()[0];
    expect(preparedSession.session.history).toHaveLength(2);
    expect(persisted?.history).toEqual(preparedSession.session.history);
    expect(persisted?.messages.map((message) => message.text)).toEqual(['Earlier prompt', 'Earlier answer']);
    expect(persisted?.context?.estimatedHistoryTokens).toBe(42);
  });

  it('preserves accepted visible user messages through preflight persistence', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-preflight-accepted-user-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.markAcceptedUserMessage(ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    }), {
      runId: 'run-1',
      prompt: 'New prompt still running',
    });
    new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).save([session]);

    ConversationTurnPreflightService.persistPrepared({
      sessionStoragePath,
      sessions: [session],
      session,
      compacted: {
        history: [
          { role: 'user', content: 'Earlier prompt' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        context: {
          estimatedHistoryTokens: 42,
        },
        archive: {
          archives: [],
        },
      },
    });

    const persisted = new FileChatSessionRepository({ sessionStoragePath: sessionStoragePath }).list()[0];
    expect(persisted?.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Earlier prompt' }),
      expect.objectContaining({ role: 'assistant', text: 'Earlier answer' }),
      expect.objectContaining({
        id: 'accepted-user-run-1',
        role: 'user',
        text: 'New prompt still running',
        isPending: true,
      }),
    ]);
  });

  it('preserves an accepted prompt even when the same text already exists in history', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-turn-preflight-repeated-prompt-'));
    const sessionStoragePath = join(root, '.heddle', 'chat-sessions.catalog.json');
    const session = ChatSessionRecords.markAcceptedUserMessage(ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    }), {
      runId: 'run-1',
      prompt: 'Repeat this prompt',
    });
    new FileChatSessionRepository({ sessionStoragePath }).save([session]);

    ConversationTurnPreflightService.persistPrepared({
      sessionStoragePath,
      sessions: [session],
      session,
      compacted: {
        history: [
          { role: 'user', content: 'Repeat this prompt' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        context: {
          estimatedHistoryTokens: 42,
        },
        archive: {
          archives: [],
        },
      },
    });

    const persisted = new FileChatSessionRepository({ sessionStoragePath }).list()[0];
    expect(persisted?.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Repeat this prompt' }),
      expect.objectContaining({ role: 'assistant', text: 'Earlier answer' }),
      expect.objectContaining({
        id: 'accepted-user-run-1',
        role: 'user',
        text: 'Repeat this prompt',
        isPending: true,
      }),
    ]);
  });
});
