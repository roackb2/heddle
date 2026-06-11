import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelOptionsService } from '@/core/llm/models/index.js';

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
      ollamaBaseUrl: 'http://ollama.local/',
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
      ollamaBaseUrl: 'http://ollama.local',
      fetchImpl,
    });

    expect(options.groups.some((group) => group.label === 'OpenAI · GPT-5.4')).toBe(true);
    expect(options.groups.some((group) => group.label === 'Ollama · Installed local models')).toBe(false);
  });
});
