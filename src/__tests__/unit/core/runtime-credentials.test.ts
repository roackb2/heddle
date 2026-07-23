import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { RuntimeCredentialService } from '@/core/runtime/credentials/index.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';

describe('RuntimeCredentialService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not fall back to OpenAI keys for Anthropic models', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('PERSONAL_ANTHROPIC_API_KEY', '');

    expect(RuntimeCredentialService.resolveApiKeyForModel('claude-sonnet-4-6')).toBeUndefined();
    expect(RuntimeCredentialService.resolveCredentialSourceForModel('claude-sonnet-4-6')).toEqual({
      type: 'missing',
      provider: 'anthropic',
    });
  });

  it('uses Anthropic keys for Anthropic models', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');

    expect(RuntimeCredentialService.resolveApiKeyForModel('claude-sonnet-4-6')).toBe('anthropic-key');
    expect(RuntimeCredentialService.resolveCredentialSourceForModel('claude-sonnet-4-6')).toEqual({
      type: 'env-api-key',
      provider: 'anthropic',
    });
  });

  it('formats credential sources for SDK host status output', () => {
    expect(RuntimeCredentialService.formatCredentialSource({ type: 'explicit-api-key' })).toBe('explicit API key');
    expect(RuntimeCredentialService.formatCredentialSource({ type: 'env-api-key', provider: 'anthropic' })).toBe('anthropic API key from environment');
    expect(RuntimeCredentialService.formatCredentialSource({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-123',
    })).toBe('openai OAuth account account-123');
    expect(RuntimeCredentialService.formatCredentialSource({
      type: 'oauth-access-token',
      provider: 'openai',
      accountId: 'account-123',
      expiresAt: Date.parse('2026-07-20T02:00:00.000Z'),
    })).toBe('openai request-scoped OAuth account account-123');
    expect(RuntimeCredentialService.formatCredentialSource({
      type: 'local-endpoint',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    })).toBe('ollama local endpoint http://localhost:11434/v1');
    expect(RuntimeCredentialService.formatCredentialSource({ type: 'missing', provider: 'openai' })).toBe('missing openai credential');
  });

  it('resolves Ollama as a local endpoint instead of reusing hosted provider keys', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    vi.stubEnv('OLLAMA_OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1/');

    expect(RuntimeCredentialService.resolveApiKeyForModel('ollama/llama3.2:latest', {
      apiKey: 'explicit-key',
      apiKeyProvider: 'explicit',
    })).toBeUndefined();
    expect(RuntimeCredentialService.resolveCredentialSourceForModel('ollama/llama3.2:latest', {
      apiKey: 'explicit-key',
      apiKeyProvider: 'explicit',
    })).toEqual({
      type: 'local-endpoint',
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    expect(RuntimeCredentialService.hasCredentialForModel('ollama/llama3.2:latest')).toBe(true);
  });

  it('normalizes OLLAMA_BASE_URL to the OpenAI-compatible v1 endpoint', () => {
    vi.stubEnv('OLLAMA_OPENAI_BASE_URL', '');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://localhost:11434/');

    expect(RuntimeCredentialService.resolveOllamaBaseUrl()).toBe('http://localhost:11434');
    expect(RuntimeCredentialService.resolveCredentialSourceForModel('ollama/qwen3:8b')).toEqual({
      type: 'local-endpoint',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('resolves no-key local OpenAI-compatible profiles as endpoints', () => {
    vi.stubEnv('LMSTUDIO_OPENAI_BASE_URL', 'http://localhost:1234/v1/');
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('lmstudio/local-model')).toEqual({
      type: 'local-endpoint',
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
    });
    expect(RuntimeCredentialService.resolveOpenAiCompatibleEndpointRuntime('lmstudio')).toEqual({
      baseUrl: 'http://localhost:1234/v1',
      auth: { type: 'none' },
    });
  });

  it('uses hosted OpenAI-compatible provider keys without falling back to OpenAI keys', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('openrouter/meta-llama/llama-3.3-70b-instruct')).toEqual({
      type: 'missing',
      provider: 'openrouter',
    });

    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-key');

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('openrouter/meta-llama/llama-3.3-70b-instruct')).toEqual({
      type: 'env-api-key',
      provider: 'openrouter',
    });
    expect(RuntimeCredentialService.resolveOpenAiCompatibleEndpointRuntime('openrouter')).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      auth: { type: 'bearer', token: 'openrouter-key' },
    });
  });

  it('uses only Kimi Platform credentials for Kimi models', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('KIMI_API_KEY', 'kimi-code-key');
    vi.stubEnv('MOONSHOT_API_KEY', '');
    vi.stubEnv('KIMI_PLATFORM_API_KEY', '');

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('kimi/kimi-k3')).toEqual({
      type: 'missing',
      provider: 'kimi',
    });

    vi.stubEnv('MOONSHOT_API_KEY', 'moonshot-key');

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('kimi/kimi-k3')).toEqual({
      type: 'env-api-key',
      provider: 'kimi',
    });
    expect(RuntimeCredentialService.resolveOpenAiCompatibleEndpointRuntime('kimi')).toEqual({
      baseUrl: 'https://api.moonshot.cn/v1',
      auth: { type: 'bearer', token: 'moonshot-key' },
    });
    expect(RuntimeCredentialService.formatMissingCredentialMessage('kimi/kimi-k3'))
      .toContain('Kimi Code membership keys use a separate service');
  });

  it('resolves executable runtime endpoint auth for hosted OpenAI-compatible models', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-key');

    expect(LlmProviderRuntimeService.resolve({
      model: 'openrouter/meta-llama/llama-3.3-70b-instruct',
    })).toMatchObject({
      model: 'openrouter/meta-llama/llama-3.3-70b-instruct',
      provider: 'openrouter',
      apiKey: 'openrouter-key',
      credentialSource: {
        type: 'env-api-key',
        provider: 'openrouter',
      },
      llmRuntime: {
        endpoint: {
          baseUrl: 'https://openrouter.ai/api/v1',
          auth: { type: 'bearer', token: 'openrouter-key' },
        },
      },
    });
  });

  it('builds model-discovery sources only for reachable local profiles and configured hosted profiles', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-key');
    vi.stubEnv('HF_TOKEN', '');
    vi.stubEnv('HUGGINGFACE_API_KEY', '');
    vi.stubEnv('TOGETHER_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('MOONSHOT_API_KEY', '');
    vi.stubEnv('KIMI_PLATFORM_API_KEY', '');

    const sources = RuntimeCredentialService.resolveOpenAiCompatibleModelDiscoverySources();

    expect(sources.map((source) => source.profile.id)).toEqual([
      'ollama',
      'lmstudio',
      'litellm',
      'vllm',
      'openrouter',
    ]);
    expect(sources.find((source) => source.profile.id === 'openrouter')).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-key',
    });
  });

  it('resolves the provider-specific key for the requested model', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-runtime-credential-provider-')), 'auth.json');

    expect(RuntimeCredentialService.resolveApiKeyForModel('gpt-5.4', {
      apiKey: 'openai-key',
      apiKeyProvider: 'openai',
      credentialStorePath: storePath,
    })).toBe('openai-key');
    expect(RuntimeCredentialService.resolveApiKeyForModel('claude-sonnet-4-6', {
      apiKey: 'openai-key',
      apiKeyProvider: 'openai',
      credentialStorePath: storePath,
    })).toBe('anthropic-key');
  });

  it('prefers stored OAuth over environment API keys unless preferApiKey is enabled', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');

    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-runtime-credential-oauth-')), 'auth.json');
    new ProviderCredentialRepository({ storePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.parse('2026-06-04T01:00:00.000Z'),
      accountId: 'account-123',
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
    });

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('gpt-5.4', {
      credentialStorePath: storePath,
    })).toEqual({
      type: 'oauth',
      provider: 'openai',
      accountId: 'account-123',
      expiresAt: Date.parse('2026-06-04T01:00:00.000Z'),
    });

    expect(RuntimeCredentialService.resolveCredentialSourceForModel('gpt-5.4', {
      credentialStorePath: storePath,
      preferApiKey: true,
    })).toEqual({
      type: 'env-api-key',
      provider: 'openai',
    });
  });

  it('resolves a request-scoped access token without falling back to an environment key', () => {
    vi.stubEnv('OPENAI_API_KEY', 'host-openai-key');
    const credential = {
      type: 'oauth-access-token' as const,
      provider: 'openai' as const,
      accessToken: 'request-access-token',
      expiresAt: Date.now() + 60 * 60_000,
      accountId: 'account-123',
    };

    expect(RuntimeCredentialService.resolveForModel('gpt-5.4', {
      credential,
      preferApiKey: true,
    })).toEqual({
      provider: 'openai',
      credential,
      source: {
        type: 'oauth-access-token',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: credential.expiresAt,
      },
    });
  });

  it('rejects ambiguous or provider-mismatched runtime credentials', () => {
    const credential = {
      type: 'oauth-access-token' as const,
      provider: 'openai' as const,
      accessToken: 'request-access-token',
      expiresAt: Date.now() + 60 * 60_000,
    };

    expect(() => RuntimeCredentialService.resolveForModel('gpt-5.4', {
      apiKey: 'api-key',
      apiKeyProvider: 'explicit',
      credential,
    })).toThrow('Provide either apiKey or credential');
    expect(() => RuntimeCredentialService.resolveForModel('claude-sonnet-4-6', {
      credential,
    })).toThrow('Runtime credential provider openai does not match model provider anthropic.');
  });
});
