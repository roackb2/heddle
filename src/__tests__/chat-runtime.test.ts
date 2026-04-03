import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiKeyForModel, resolveChatRuntimeConfig } from '../cli/chat/utils/runtime.js';

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
  });

  it('uses Anthropic keys for Anthropic models', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'claude-sonnet-4-6',
    });

    expect(runtime.apiKey).toBe('anthropic-key');
  });

  it('resolves the correct provider key for a session model even if startup used another provider', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');

    const runtime = resolveChatRuntimeConfig({
      workspaceRoot: '/tmp/heddle-test',
      model: 'gpt-5.4',
    });

    expect(runtime.apiKey).toBe('openai-key');
    expect(runtime.apiKeyProvider).toBe('openai');
    expect(resolveApiKeyForModel('claude-sonnet-4-6', runtime)).toBe('anthropic-key');
  });
});
