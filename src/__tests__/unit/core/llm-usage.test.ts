import type { Usage } from '@anthropic-ai/sdk/resources/messages';
import type { Response as OpenAiResponse } from 'openai/resources/responses/responses.js';
import { describe, expect, it } from 'vitest';
import { AnthropicCodec } from '../../../core/llm/adapters/anthropic/anthropic-codec.js';
import { OpenAiCodec } from '../../../core/llm/adapters/openai/openai-codec.js';
import { LlmUsageService } from '../../../core/llm/usage/index.js';

describe('LlmUsageService', () => {
  it('preserves Anthropic billed, cache-read, and cache-write counters', () => {
    const usage = AnthropicCodec.extractUsage({
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 70,
    } as Usage, 'claude-opus-4-1');

    expect(usage).toEqual({
      inputTokens: 200,
      billedInputTokens: 100,
      outputTokens: 20,
      totalTokens: 220,
      cachedInputTokens: 70,
      cacheWriteInputTokens: 30,
      requests: 1,
      cost: { status: 'unavailable' },
      byModel: [{
        provider: 'anthropic',
        model: 'claude-opus-4-1',
        inputTokens: 200,
        billedInputTokens: 100,
        outputTokens: 20,
        totalTokens: 220,
        cachedInputTokens: 70,
        cacheWriteInputTokens: 30,
        requests: 1,
        cost: { status: 'unavailable' },
      }],
    });
  });

  it('keeps unavailable Anthropic cache counters absent for uncached responses', () => {
    const usage = AnthropicCodec.extractUsage({
      input_tokens: 50,
      output_tokens: 10,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    } as Usage, 'claude-sonnet-4-6');

    expect(usage).toMatchObject({
      inputTokens: 50,
      billedInputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
      requests: 1,
      cost: { status: 'unavailable' },
    });
    expect(usage).not.toHaveProperty('cachedInputTokens');
    expect(usage).not.toHaveProperty('cacheWriteInputTokens');
  });

  it('maps OpenAI cache reads into the same normalized contract', () => {
    const usage = OpenAiCodec.extractUsage({
      model: 'gpt-5.6-sol',
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 5 },
        total_tokens: 120,
      },
    } as OpenAiResponse);

    expect(usage).toEqual({
      inputTokens: 100,
      billedInputTokens: 75,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 25,
      reasoningTokens: 5,
      requests: 1,
      cost: { status: 'unavailable' },
      byModel: [{
        provider: 'openai',
        model: 'gpt-5.6-sol',
        inputTokens: 100,
        billedInputTokens: 75,
        outputTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 25,
        reasoningTokens: 5,
        requests: 1,
        cost: { status: 'unavailable' },
      }],
    });
  });

  it('aggregates requests by their actual provider and model', () => {
    const anthropic = LlmUsageService.fromProviderRequest({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      billedInputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 15,
    });
    const openAi = LlmUsageService.fromProviderRequest({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      billedInputTokens: 40,
      cachedInputTokens: 10,
      outputTokens: 5,
      providerReportedCostUsd: 0.012,
    });

    expect(LlmUsageService.aggregate(anthropic, openAi)).toEqual({
      inputTokens: 150,
      billedInputTokens: 120,
      outputTokens: 20,
      totalTokens: 170,
      cachedInputTokens: 30,
      requests: 2,
      cost: {
        status: 'partial',
        reportedAmountUsd: 0.012,
        unavailableRequests: 1,
      },
      byModel: [
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          requests: 1,
          cost: { status: 'unavailable' },
        }),
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-5.6-terra',
          requests: 1,
          cost: { status: 'reported', amountUsd: 0.012 },
        }),
      ],
    });
  });

  it('merges repeated model requests without losing request count or cost', () => {
    const first = LlmUsageService.fromProviderRequest({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      billedInputTokens: 30,
      outputTokens: 10,
      providerReportedCostUsd: 0.01,
    });
    const second = LlmUsageService.fromProviderRequest({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      billedInputTokens: 40,
      outputTokens: 20,
      providerReportedCostUsd: 0.02,
    });

    const usage = LlmUsageService.aggregate(first, second);
    expect(usage?.requests).toBe(2);
    expect(usage?.cost).toEqual({ status: 'reported', amountUsd: 0.03 });
    expect(usage?.byModel).toEqual([
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.6-sol',
        inputTokens: 70,
        outputTokens: 30,
        requests: 2,
        cost: { status: 'reported', amountUsd: 0.03 },
      }),
    ]);
  });

  it('marks legacy aggregate-only requests as unattributed', () => {
    expect(LlmUsageService.aggregate(undefined, {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      requests: 1,
    })).toEqual({
      inputTokens: 10,
      billedInputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      requests: 1,
      cost: { status: 'unavailable' },
      unattributedRequests: 1,
    });
  });
});
