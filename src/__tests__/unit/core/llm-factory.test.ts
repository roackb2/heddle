import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OPENAI_CODEX_RESPONSES_ENDPOINT,
} from '../../../core/auth/openai-oauth.js';
import { ProviderCredentialRepository } from '../../../core/auth/index.js';
import { AnthropicAdapter } from '../../../core/llm/adapters/anthropic/index.js';
import { LlmAdapterService } from '../../../core/llm/index.js';
import { ModelPolicyService } from '../../../core/llm/models/index.js';

describe('llm adapter factory', () => {
  it('infers provider from known model prefixes', () => {
    expect(LlmAdapterService.inferProvider('gpt-5.1-codex')).toBe('openai');
    expect(LlmAdapterService.inferProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(LlmAdapterService.inferProvider('gemini-2.5-pro')).toBe('google');
  });

  it('prefers an explicit provider over model inference', () => {
    expect(LlmAdapterService.resolveProvider({ provider: 'openai', model: 'claude-sonnet-4-6' })).toBe('openai');
  });

  it('returns an OpenAI adapter with provider metadata for OpenAI models', () => {
    const adapter = LlmAdapterService.create({ model: 'gpt-5.1-codex', credentials: { apiKey: 'test-key' } });

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

  it('loads stored OpenAI OAuth credentials when creating an adapter without an API key', async () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-llm-oauth-')), 'auth.json');
    new ProviderCredentialRepository({ storePath }).set({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    });
    const requests: Array<{ url: string; headers: Headers }> = [];
    const adapter = LlmAdapterService.create({
      model: 'gpt-5.4',
      credentials: { credentialStorePath: storePath },
      runtime: {
        fetchImpl: (async (url, init) => {
          requests.push({ url: String(url), headers: new Headers((init as RequestInit | undefined)?.headers) });
          return new Response([
            'event: response.created',
            'data: {"type":"response.created","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"in_progress","model":"gpt-5.4","output":[]}}',
            '',
            'event: response.output_text.done',
            'data: {"type":"response.output_text.done","text":"Done.","content_index":0,"item_id":"msg_1","output_index":0,"sequence_number":2}',
            '',
            'event: response.completed',
            'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"completed","completed_at":1777301835,"model":"gpt-5.4","output_text":"Done.","output":[],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":15}}}',
            '',
          ].join('\n'), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }) as typeof fetch,
      },
    });

    const result = await adapter.chat([{ role: 'user', content: 'hello' }], []);

    expect(result.content).toBe('Done.');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(OPENAI_CODEX_RESPONSES_ENDPOINT);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer stored-access-token');
    expect(requests[0]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
  });

  it('returns an Anthropic adapter with provider metadata for Claude models', () => {
    const adapter = LlmAdapterService.create({ model: 'claude-sonnet-4-6', credentials: { apiKey: 'test-key' } });

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
    const adapter = new AnthropicAdapter({
      model: 'claude-sonnet-4-6',
      credentials: { apiKey: 'test-key' },
    });
    expect(adapter.info?.provider).toBe('anthropic');
    expect(adapter.info?.model).toBe('claude-sonnet-4-6');
  });

  it('marks unsupported OAuth models as disabled in credential-aware options', () => {
    const option = ModelPolicyService.buildCredentialAwareModelOption({
      model: 'gpt-5.4-pro',
      provider: 'openai',
      credentialMode: 'oauth',
    });

    expect(option).toEqual({
      id: 'gpt-5.4-pro',
      disabled: true,
      disabledReason: 'Not supported',
      label: undefined,
    });
  });

  it('switches unsupported OAuth active models to the safe default with a warning', () => {
    expect(ModelPolicyService.resolveCompatibleActiveModel({
      activeModel: 'gpt-5.4-pro',
      provider: 'openai',
      credentialMode: 'oauth',
    })).toEqual({
      model: 'gpt-5.4',
      warning: 'Model gpt-5.4-pro is not supported with OpenAI account sign-in. Switched to gpt-5.4 for this session.',
    });
  });

  it('uses the active model for non-OpenAI system model selection', () => {
    expect(ModelPolicyService.resolveSystemSelectedModel({
      purpose: 'chat-compaction',
      provider: 'ollama',
      activeModel: 'ollama/qwen3:8b',
    })).toBe('ollama/qwen3:8b');

    expect(ModelPolicyService.resolveSystemSelectedModel({
      purpose: 'session-title',
      provider: 'huggingface',
      activeModel: 'huggingface/meta-llama/Llama-3.3-70B-Instruct',
    })).toBe('huggingface/meta-llama/Llama-3.3-70B-Instruct');
  });

  it('fails clearly when non-OpenAI system model selection has no active model', () => {
    expect(() => ModelPolicyService.resolveSystemSelectedModel({
      purpose: 'chat-compaction',
      provider: 'ollama',
    })).toThrow('No chat-compaction system model is configured for ollama.');
  });

  it('owns per-model reasoning effort support', () => {
    expect(ModelPolicyService.supportsOpenAiRequestReasoningEffortLevel('gpt-5.4', 'ultrahigh')).toBe(false);
    expect(ModelPolicyService.supportsOpenAiRequestReasoningEffortLevel('gpt-5.5', 'ultrahigh')).toBe(true);
    expect(ModelPolicyService.buildReasoningEffortOptions('gpt-5.5')).toContainEqual({
      id: 'ultrahigh',
      label: 'ultrahigh',
      description: 'Set explicit ultrahigh effort',
      disabled: false,
      disabledReason: undefined,
    });
  });
});
