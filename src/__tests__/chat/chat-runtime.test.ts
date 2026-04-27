import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAgentTurn } from '../../cli/chat/hooks/useAgentRun.js';
import type { ChatSession } from '../../cli/chat/state/types.js';
import { resolveApiKeyForModel, resolveChatRuntimeConfig, resolveProviderCredentialSourceForModel } from '../../cli/chat/utils/runtime.js';
import { createLogger } from '../../core/utils/logger.js';
import type { LlmAdapter, RunResult, ToolCall, ToolDefinition } from '../../index.js';
import { setStoredProviderCredential } from '../../core/auth/provider-credentials.js';

describe('resolveChatRuntimeConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not fall back to OpenAI keys for Anthropic models', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('PERSONAL_ANTHROPIC_API_KEY', '');

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'claude-sonnet-4-6',
    });

    expect(runtime.apiKey).toBeUndefined();
    expect(runtime.providerCredentialPresent).toBe(false);
    expect(runtime.providerCredentialSource).toEqual({ type: 'missing', provider: 'anthropic' });
  });

  it('uses Anthropic keys for Anthropic models', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'claude-sonnet-4-6',
    });

    expect(runtime.apiKey).toBe('anthropic-key');
    expect(runtime.providerCredentialPresent).toBe(true);
    expect(runtime.providerCredentialSource).toEqual({ type: 'env-api-key', provider: 'anthropic' });
  });

  it('resolves the correct provider key for a session model even if startup used another provider', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-chat-no-oauth-')), 'auth.json');

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'gpt-5.4',
      credentialStorePath: storePath,
    });

    expect(runtime.apiKey).toBe('openai-key');
    expect(runtime.apiKeyProvider).toBe('openai');
    expect(runtime.providerCredentialSource).toEqual({ type: 'env-api-key', provider: 'openai' });
    expect(resolveApiKeyForModel('claude-sonnet-4-6', runtime)).toBe('anthropic-key');
  });

  it('prefers stored OpenAI OAuth over environment API keys unless a key is explicit', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-chat-oauth-')), 'auth.json');
    const now = '2026-04-27T00:00:00.000Z';
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
      accountId: 'account-1234567890',
      createdAt: now,
      updatedAt: now,
    }, storePath);

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'gpt-5.1-codex',
      credentialStorePath: storePath,
    });

    expect(runtime.apiKey).toBeUndefined();
    expect(runtime.providerCredentialPresent).toBe(true);
    expect(runtime.providerCredentialSource).toEqual({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-1234567890',
      expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
    });
    expect(resolveProviderCredentialSourceForModel('gpt-5.1-codex-mini', { credentialStorePath: storePath })).toEqual({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-1234567890',
      expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
    });
    expect(resolveApiKeyForModel('gpt-5.1-codex-mini', {
      apiKey: 'openai-key',
      apiKeyProvider: 'openai',
      credentialStorePath: storePath,
    })).toBeUndefined();

    const explicitRuntime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'gpt-5.1-codex',
      apiKey: 'explicit-key',
      credentialStorePath: storePath,
    });
    expect(explicitRuntime.apiKey).toBe('explicit-key');
    expect(explicitRuntime.providerCredentialSource).toEqual({ type: 'explicit-api-key' });
  });

  it('uses environment API keys ahead of stored OAuth when preferApiKey is enabled', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-chat-prefer-key-')), 'auth.json');
    const now = '2026-04-27T00:00:00.000Z';
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-04-27T01:00:00.000Z'),
      accountId: 'account-1234567890',
      createdAt: now,
      updatedAt: now,
    }, storePath);

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'gpt-5.4',
      credentialStorePath: storePath,
      preferApiKey: true,
    });

    expect(runtime.apiKey).toBe('openai-key');
    expect(runtime.preferApiKey).toBe(true);
    expect(runtime.providerCredentialSource).toEqual({ type: 'env-api-key', provider: 'openai' });
    expect(resolveProviderCredentialSourceForModel('gpt-5.4', {
      credentialStorePath: storePath,
      preferApiKey: true,
    })).toEqual({ type: 'env-api-key', provider: 'openai' });
  });

  it('loads the workspace memory root catalog into startup context', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-memory-context-'));
    const memoryRoot = join(workspaceRoot, '.heddle', 'memory');
    mkdirSync(memoryRoot, { recursive: true });
    writeFileSync(join(memoryRoot, 'README.md'), '# Workspace Memory\n\n- Read current-state first.\n', 'utf8');

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot,
      model: 'gpt-test',
      systemContext: 'Source: AGENTS.md\nRead docs first.',
    });

    expect(runtime.systemContext).toContain('Source: AGENTS.md');
    expect(runtime.systemContext).toContain('## Workspace Memory Catalog');
    expect(runtime.systemContext).toContain('- Read current-state first.');
  });
});

describe('executeAgentTurn final message persistence', () => {
  function createRuntime() {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-runtime-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const traceDir = join(stateRoot, 'traces');
    const memoryDir = join(stateRoot, 'memory');
    mkdirSync(traceDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });

    return {
      model: 'gpt-test',
      maxSteps: 4,
      apiKey: 'test-key',
      apiKeyProvider: 'explicit' as const,
      preferApiKey: false,
      providerCredentialPresent: true,
      providerCredentialSource: { type: 'explicit-api-key' as const },
      stateRoot,
      logFile: join(stateRoot, 'logs', 'test.log'),
      sessionCatalogFile: join(stateRoot, 'chat-sessions.catalog.json'),
      approvalsFile: join(stateRoot, 'command-approvals.json'),
      traceDir,
      memoryDir,
      workspaceRoot,
      directShellApproval: 'never' as const,
      searchIgnoreDirs: [],
      systemContext: undefined,
    };
  }

  function createState() {
    let localId = 0;
    return {
      isRunning: false,
      interruptRequestedRef: { current: false },
      abortControllerRef: { current: undefined as AbortController | undefined },
      nextLocalId: () => `local-${++localId}`,
      setError: vi.fn(),
      setStatus: vi.fn(),
      setIsRunning: vi.fn(),
      setInterruptRequested: vi.fn(),
      setLiveEvents: vi.fn(),
      setPendingApproval: vi.fn(),
      setApprovalChoice: vi.fn(),
      setCurrentEditPreview: vi.fn(),
      setCurrentPlan: vi.fn(),
      setCurrentAssistantText: vi.fn(),
    };
  }

  function createSession(): ChatSession {
    return {
      id: 'session-1',
      name: 'Session 1',
      history: [],
      messages: [],
      turns: [],
      createdAt: '2026-04-17T00:00:00.000Z',
      updatedAt: '2026-04-17T00:00:00.000Z',
    };
  }

  async function runTurn(outcome: RunResult['outcome'], summary: string) {
    const runtime = createRuntime();
    const state = createState();
    let session = createSession();

    const llm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-test',
        capabilities: {
          toolCalls: true,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: true,
        },
      },
      chat: vi.fn(),
    };

    const tools: ToolDefinition[] = [];
    const logger = createLogger({ level: 'silent', console: false });

    const updateSessionById = (_sessionId: string, updater: (current: ChatSession) => ChatSession) => {
      session = updater(session);
    };

    const result: RunResult = {
      outcome,
      summary,
      trace: [
        {
          type: 'assistant.turn',
          content: summary,
          requestedTools: false,
          step: 1,
          timestamp: '2026-04-17T00:00:01.000Z',
        },
        {
          type: 'run.finished',
          outcome,
          summary,
          step: 1,
          timestamp: '2026-04-17T00:00:02.000Z',
        },
      ],
      transcript: [
        { role: 'user', content: 'test prompt' },
        { role: 'assistant', content: summary },
      ],
    };

    const runAgentLoopSpy = vi.spyOn(await import('../../index.js'), 'runAgentLoop').mockResolvedValue(result as never);

    await executeAgentTurn({
      prompt: 'test prompt',
      displayText: 'test prompt',
      sessionId: session.id,
      sessionHistory: session.history,
      runtime,
      llm,
      tools,
      logger,
      state,
      updateSessionById,
      maybeAutoNameSession: vi.fn(),
      isProjectApproved: (_call: ToolCall) => false,
      rememberProjectApproval: vi.fn(),
    });

    runAgentLoopSpy.mockRestore();
    return { session, state };
  }

  it('persists one final assistant summary for done runs', async () => {
    const { session } = await runTurn('done', 'All set.');

    expect(session.messages.map((message) => message.text)).toEqual(['test prompt', 'All set.']);
    expect(session.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  it('persists one stopped summary for interrupted runs', async () => {
    const { session } = await runTurn('interrupted', 'Stopped after approval denied.');

    expect(session.messages.map((message) => message.text)).toEqual([
      'test prompt',
      'Run stopped: Stopped after approval denied.',
    ]);
    expect(session.messages.filter((message) => message.text === 'Run stopped: Stopped after approval denied.')).toHaveLength(1);
  });
});
