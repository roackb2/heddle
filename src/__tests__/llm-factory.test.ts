import { describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from '../core/llm/anthropic.js';
import { createLlmAdapter, inferProviderFromModel, resolveLlmProvider } from '../core/llm/factory.js';

describe('llm adapter factory', () => {
  it('infers provider from known model prefixes', () => {
    expect(inferProviderFromModel('gpt-5.1-codex')).toBe('openai');
    expect(inferProviderFromModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferProviderFromModel('gemini-2.5-pro')).toBe('google');
  });

  it('prefers an explicit provider over model inference', () => {
    expect(resolveLlmProvider({ provider: 'openai', model: 'claude-sonnet-4-6' })).toBe('openai');
  });

  it('returns an OpenAI adapter with provider metadata for OpenAI models', () => {
    const adapter = createLlmAdapter({ model: 'gpt-5.1-codex', apiKey: 'test-key' });

    expect(adapter.info).toEqual({
      provider: 'openai',
      model: 'gpt-5.1-codex',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: true,
        parallelToolCalls: true,
      },
    });
  });

  it('returns an Anthropic adapter with provider metadata for Claude models', () => {
    const adapter = createLlmAdapter({ model: 'claude-sonnet-4-6', apiKey: 'test-key' });

    expect(adapter.info).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: false,
      },
    });
  });

  it('exports a direct Anthropic adapter constructor', () => {
    const adapter = createAnthropicAdapter({ model: 'claude-sonnet-4-6', apiKey: 'test-key' });
    expect(adapter.info?.provider).toBe('anthropic');
    expect(adapter.info?.model).toBe('claude-sonnet-4-6');
  });
});
