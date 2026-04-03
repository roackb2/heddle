import { describe, expect, it } from 'vitest';
import { createLlmAdapter, inferProviderFromModel, resolveLlmProvider } from '../llm/factory.js';

describe('llm adapter factory', () => {
  it('infers provider from known model prefixes', () => {
    expect(inferProviderFromModel('gpt-5.1-codex')).toBe('openai');
    expect(inferProviderFromModel('claude-3-7-sonnet')).toBe('anthropic');
    expect(inferProviderFromModel('gemini-2.5-pro')).toBe('google');
  });

  it('prefers an explicit provider over model inference', () => {
    expect(resolveLlmProvider({ provider: 'openai', model: 'claude-3-7-sonnet' })).toBe('openai');
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

  it('fails fast for unsupported Claude wiring with a provider-aware error', () => {
    expect(() => createLlmAdapter({ model: 'claude-3-7-sonnet', apiKey: 'test-key' })).toThrow(
      'Model provider "anthropic" is not wired yet.',
    );
  });
});
