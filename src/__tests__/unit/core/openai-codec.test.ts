import { describe, expect, it } from 'vitest';
import { OpenAiCodec } from '@/core/llm/adapters/openai/openai-codec.js';
import type { ChatMessage } from '@/core/llm/types.js';

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

describe('OpenAiCodec.buildResponsesRequest reasoning parameter', () => {
  it('omits reasoning for non-reasoning API-key models like gpt-4.1', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'gpt-4.1',
      tools: [],
      oauthMode: false,
    });

    // gpt-4.1 rejects `reasoning.summary` with a 400; it must not be sent.
    expect(request.reasoning).toBeUndefined();
    expect(request.model).toBe('gpt-4.1');
  });

  it('sends reasoning with the resolved default effort for reasoning API-key models', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'gpt-5.4',
      tools: [],
      oauthMode: false,
    });

    expect(request.reasoning).toEqual({ summary: 'detailed', effort: 'medium' });
  });

  it('keeps summaries for o-series models without a Heddle-managed effort', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'o4-mini',
      tools: [],
      oauthMode: false,
    });

    expect(request.reasoning).toEqual({ summary: 'detailed' });
  });

  it('keeps summary auto in OAuth mode', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'gpt-5.4',
      tools: [],
      oauthMode: true,
    });

    expect(request.reasoning).toEqual(expect.objectContaining({ summary: 'auto' }));
  });

  it('keeps summaries for Codex API-key models without a Heddle-managed effort', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'gpt-5.2-codex',
      tools: [],
      oauthMode: false,
    });

    expect(request.reasoning).toEqual({ summary: 'detailed' });
  });

  it('omits reasoning for unknown API-key models', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'custom-openai-model',
      tools: [],
      oauthMode: false,
    });

    expect(request.reasoning).toBeUndefined();
  });

  it('still sends reasoning in OAuth mode for codex models', () => {
    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: 'gpt-5.2-codex',
      tools: [],
      oauthMode: true,
    });

    expect(request.reasoning).toEqual({ summary: 'auto' });
  });
});
