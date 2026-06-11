import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelOptionsService } from '@/core/llm/models/index.js';
import { OpenAiCompatibleProviderProfileService } from '@/core/llm/index.js';

describe('ModelOptionsService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds installed Ollama models to the shared control-plane model options', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      models: [
        {
          name: 'qwen3:8b',
          size: 5_234,
          modified_at: '2026-06-11T00:00:00Z',
          capabilities: ['completion', 'tools'],
        },
        {
          name: 'llama3.2:latest',
          size: 1_234,
          modified_at: '2026-06-10T00:00:00Z',
          capabilities: ['completion'],
        },
        {
          name: 'nomic-embed-text:latest',
          size: 234,
          modified_at: '2026-06-09T00:00:00Z',
          capabilities: ['embedding'],
        },
      ],
    })));

    const options = await ModelOptionsService.resolve({
      openAiCompatibleSources: [{
        profile: OpenAiCompatibleProviderProfileService.get('ollama'),
        baseUrl: 'http://ollama.local/v1',
        nativeBaseUrl: 'http://ollama.local/',
      }],
      fetchImpl,
    });
    const ollamaGroup = options.groups.find((group) => group.label === 'Ollama · Installed local models');

    expect(fetchImpl).toHaveBeenCalledWith('http://ollama.local/api/tags', {
      method: 'GET',
      signal: undefined,
    });
    expect(ollamaGroup).toMatchObject({
      label: 'Ollama · Installed local models',
      source: 'local-discovered',
      models: ['ollama/llama3.2:latest', 'ollama/qwen3:8b'],
      options: [
        {
          id: 'ollama/llama3.2:latest',
          label: 'llama3.2:latest',
          disabled: false,
          disabledReason: undefined,
        },
        {
          id: 'ollama/qwen3:8b',
          label: 'qwen3:8b',
          disabled: false,
          disabledReason: undefined,
        },
      ],
    });
  });

  it('keeps built-in model options available when Ollama is not running', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    });

    const options = await ModelOptionsService.resolve({
      openAiCompatibleSources: [{
        profile: OpenAiCompatibleProviderProfileService.get('ollama'),
        baseUrl: 'http://ollama.local/v1',
        nativeBaseUrl: 'http://ollama.local',
      }],
      fetchImpl,
    });

    expect(options.groups.some((group) => group.label === 'OpenAI · GPT-5.4')).toBe(true);
    expect(options.groups.some((group) => group.label === 'Ollama · Installed local models')).toBe(false);
  });

  it('adds OpenAI-compatible profile models from /models to shared model options', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'meta-llama/llama-3.3-70b-instruct' },
        { id: 'nomic-embed-text' },
        { id: 'qwen/qwen3-coder' },
      ],
    })));

    const options = await ModelOptionsService.resolve({
      openAiCompatibleSources: [{
        profile: OpenAiCompatibleProviderProfileService.get('openrouter'),
        baseUrl: 'https://openrouter.test/api/v1',
        apiKey: 'openrouter-key',
      }],
      fetchImpl,
    });
    const openRouterGroup = options.groups.find((group) => group.label === 'OpenRouter · Available models');

    expect(fetchImpl).toHaveBeenCalledWith('https://openrouter.test/api/v1/models', {
      method: 'GET',
      signal: undefined,
      headers: { authorization: 'Bearer openrouter-key' },
    });
    expect(openRouterGroup).toMatchObject({
      label: 'OpenRouter · Available models',
      source: 'remote-discovered',
      models: [
        'openrouter/meta-llama/llama-3.3-70b-instruct',
        'openrouter/qwen/qwen3-coder',
      ],
      options: [
        {
          id: 'openrouter/meta-llama/llama-3.3-70b-instruct',
          label: 'meta-llama/llama-3.3-70b-instruct',
          disabled: false,
          disabledReason: undefined,
        },
        {
          id: 'openrouter/qwen/qwen3-coder',
          label: 'qwen/qwen3-coder',
          disabled: false,
          disabledReason: undefined,
        },
      ],
    });
  });
});
