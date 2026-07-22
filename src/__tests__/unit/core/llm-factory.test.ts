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
import { ModelCatalogService, ModelPolicyService } from '../../../core/llm/models/index.js';

describe('llm adapter factory', () => {
  it('infers provider from known model prefixes', () => {
    expect(LlmAdapterService.inferProvider('gpt-5.1-codex')).toBe('openai');
    expect(LlmAdapterService.inferProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(LlmAdapterService.inferProvider('gemini-2.5-pro')).toBe('google');
    expect(LlmAdapterService.inferProvider('ollama/llama3.2:latest')).toBe('ollama');
    expect(LlmAdapterService.inferProvider('lmstudio/local-model')).toBe('lmstudio');
    expect(LlmAdapterService.inferProvider('hf/meta-llama/Llama-3.3-70B-Instruct')).toBe('huggingface');
    expect(LlmAdapterService.inferProvider('openrouter/anthropic/claude-sonnet-4.5')).toBe('openrouter');
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
            'event: response.output_item.added',
            'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","role":"assistant","content":[{"type":"output_text","text":"","annotations":[]}]},"output_index":0,"sequence_number":2}',
            '',
            'event: response.output_text.done',
            'data: {"type":"response.output_text.done","text":"Done.","content_index":0,"item_id":"msg_1","output_index":0,"sequence_number":3}',
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

  it('returns an Ollama adapter with provider metadata for local models', () => {
    const adapter = LlmAdapterService.create({
      model: 'ollama/llama3.2:latest',
      runtime: {
        endpoint: {
          baseUrl: 'http://127.0.0.1:11434/v1',
          auth: { type: 'none' },
        },
      },
    });

    expect(adapter.info).toEqual({
      provider: 'ollama',
      model: 'ollama/llama3.2:latest',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: false,
      },
    });
  });

  it('sends Ollama chat-completions requests with provider-local model names and parses tool calls', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const adapter = LlmAdapterService.create({
      model: 'ollama/llama3.2:latest',
      runtime: {
        endpoint: {
          baseUrl: 'http://ollama.test/v1',
          auth: { type: 'none' },
        },
        fetchImpl: (async (url, init) => {
          requests.push({
            url: String(url),
            body: JSON.parse(String((init as RequestInit).body)),
          });
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: '',
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'add',
                    arguments: '{"a":2,"b":3}',
                  },
                }],
              },
            }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4,
              total_tokens: 14,
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
    });

    const result = await adapter.chat(
      [{ role: 'user', content: 'add 2 and 3' }],
      [{
        name: 'add',
        description: 'Add two numbers.',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        execute: async () => ({ ok: true, output: 5 }),
      }],
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://ollama.test/v1/chat/completions');
    expect(requests[0]?.body).toMatchObject({
      model: 'llama3.2:latest',
      tool_choice: 'auto',
    });
    expect(result).toEqual({
      content: undefined,
      toolCalls: [{ id: 'call_1', tool: 'add', input: { a: 2, b: 3 } }],
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        requests: 1,
      },
    });
  });

  it('sends OpenAI-compatible profile requests with bearer auth and provider-local model names', async () => {
    const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const adapter = LlmAdapterService.create({
      model: 'openrouter/meta-llama/llama-3.3-70b-instruct',
      runtime: {
        endpoint: {
          baseUrl: 'https://openrouter.test/api/v1',
          auth: { type: 'bearer', token: 'openrouter-key' },
        },
        fetchImpl: (async (url, init) => {
          requests.push({
            url: String(url),
            headers: new Headers((init as RequestInit).headers),
            body: JSON.parse(String((init as RequestInit).body)),
          });
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: 'ok',
              },
            }],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 1,
              total_tokens: 4,
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
    });

    const result = await adapter.chat([{ role: 'user', content: 'hello' }], []);

    expect(adapter.info).toEqual({
      provider: 'openrouter',
      model: 'openrouter/meta-llama/llama-3.3-70b-instruct',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: false,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer openrouter-key');
    expect(requests[0]?.body).toMatchObject({
      model: 'meta-llama/llama-3.3-70b-instruct',
      stream: false,
    });
    expect(result.content).toBe('ok');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      totalTokens: 4,
      requests: 1,
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

    expect(ModelPolicyService.supportedOpenAiRequestReasoningEfforts('gpt-5.6-sol')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'ultrahigh',
      'max',
    ]);
    expect(ModelPolicyService.buildReasoningEffortOptions('gpt-5.6-terra')).toContainEqual({
      id: 'max',
      label: 'max',
      description: 'Set explicit max effort',
      disabled: false,
      disabledReason: undefined,
    });
  });

  it('supports the GPT-5.6 family across catalog and account sign-in policy', () => {
    expect(ModelCatalogService.isCommonBuiltInModel('gpt-5.6-sol')).toBe(true);
    expect(ModelCatalogService.isOpenAiAccountSignInModel('gpt-5.6')).toBe(true);
    expect(ModelCatalogService.isOpenAiAccountSignInModel('gpt-5.6-terra')).toBe(true);
    expect(ModelCatalogService.estimateOpenAiContextWindow('gpt-5.6-luna')).toBe(1_050_000);
    expect(ModelPolicyService.resolveDefaultReasoningEffort('gpt-5.6-sol')).toBe('medium');
  });

  it('owns reasoning-summary support independently from configurable effort', () => {
    expect(ModelPolicyService.supportsOpenAiReasoningSummary('gpt-4.1')).toBe(false);
    expect(ModelPolicyService.supportsOpenAiReasoningSummary('o4-mini')).toBe(true);
    expect(ModelPolicyService.supportsReasoningEffort('o4-mini')).toBe(false);
    expect(ModelPolicyService.supportsOpenAiReasoningSummary('gpt-5.2-codex')).toBe(true);
    expect(ModelPolicyService.supportsOpenAiReasoningSummary('gpt-5.4-2026-01-01')).toBe(true);
  });
});
