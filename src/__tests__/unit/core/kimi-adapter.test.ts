import { describe, expect, it } from 'vitest';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { LlmStreamEvent } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';

describe('KimiAdapter', () => {
  it('streams content, accumulates tool calls, and replays preserved thinking exactly', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const responses = [
      kimiSseResponse([
        { choices: [{ delta: { reasoning_content: 'Inspect the ' } }] },
        { choices: [{ delta: { reasoning_content: 'tool.' } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_1',
                function: { name: 'add', arguments: '{"a":2,' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"b":3}' } }],
            },
          }],
        },
        {
          choices: [],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 7,
            total_tokens: 17,
            prompt_tokens_details: { cached_tokens: 4 },
            completion_tokens_details: { reasoning_tokens: 5 },
          },
        },
      ], { fragmentSize: 17 }),
      kimiSseResponse([
        { choices: [{ delta: { reasoning_content: 'Use the result.' } }] },
        { choices: [{ delta: { content: 'The answer is ' } }] },
        { choices: [{ delta: { content: '5.' } }] },
      ], { fragmentSize: 11 }),
    ];
    const fetchImpl = (async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers((init as RequestInit).headers),
        body: JSON.parse(String((init as RequestInit).body)),
      });
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request.');
      }
      return response;
    }) as typeof fetch;
    const adapter = LlmAdapterService.create({
      model: 'kimi/kimi-k3',
      runtime: {
        endpoint: {
          baseUrl: 'https://kimi.test/v1/',
          auth: { type: 'bearer', token: 'moonshot-key' },
        },
        reasoningEffort: 'high',
        fetchImpl,
      },
    });
    const events: LlmStreamEvent[] = [];
    const tools: ToolDefinition[] = [addTool];

    const toolRequest = await adapter.chat(
      [{ role: 'user', content: 'Add 2 and 3.' }],
      tools,
      undefined,
      (event) => events.push(event),
    );

    expect(toolRequest).toEqual({
      content: undefined,
      toolCalls: [{ id: 'call_1', tool: 'add', input: { a: 2, b: 3 } }],
      providerContinuation: {
        provider: 'kimi',
        reasoningContent: 'Inspect the tool.',
      },
      usage: {
        inputTokens: 10,
        outputTokens: 7,
        totalTokens: 17,
        cachedInputTokens: 4,
        reasoningTokens: 5,
        requests: 1,
      },
    });
    expect(events).toEqual([]);

    const answer = await adapter.chat([
      { role: 'user', content: 'Add 2 and 3.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: toolRequest.toolCalls,
        providerContinuation: toolRequest.providerContinuation,
      },
      { role: 'tool', content: '{"ok":true,"output":5}', toolCallId: 'call_1' },
    ], tools, undefined, (event) => events.push(event));

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://kimi.test/v1/chat/completions',
      body: {
        model: 'kimi-k3',
        reasoning_effort: 'high',
        stream: true,
        stream_options: { include_usage: true },
        tool_choice: 'auto',
      },
    });
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer moonshot-key');
    expect(requests[0]?.body).toMatchObject({
      tools: [{ function: { name: 'add', strict: false } }],
    });
    expect(requests[1]?.body).toMatchObject({
      messages: [{ role: 'user' }, {
        role: 'assistant',
        content: null,
        reasoning_content: 'Inspect the tool.',
        tool_calls: [{ id: 'call_1' }],
      }, { role: 'tool', tool_call_id: 'call_1' }],
    });
    expect(answer).toMatchObject({
      content: 'The answer is 5.',
      providerContinuation: {
        provider: 'kimi',
        reasoningContent: 'Use the result.',
      },
    });
    expect(events).toEqual([
      { type: 'content.delta', delta: 'The answer is ' },
      { type: 'content.delta', delta: '5.' },
      { type: 'content.done', content: 'The answer is 5.' },
    ]);
    expect(events.some((event) => event.type === 'reasoning_summary.delta')).toBe(false);
  });

  it('rejects unsupported explicit reasoning effort instead of silently changing it', () => {
    expect(() => LlmAdapterService.create({
      model: 'kimi/kimi-k3',
      runtime: {
        endpoint: {
          baseUrl: 'https://api.moonshot.cn/v1',
          auth: { type: 'bearer', token: 'moonshot-key' },
        },
        reasoningEffort: 'medium',
      },
    })).toThrow('Kimi K3 reasoning effort must be low, high, or max; received medium.');
  });

  it('rejects a truncated stream without returning a partial completion', async () => {
    const adapter = LlmAdapterService.create({
      model: 'kimi/kimi-k3',
      runtime: {
        endpoint: {
          baseUrl: 'https://api.moonshot.cn/v1',
          auth: { type: 'bearer', token: 'moonshot-key' },
        },
        fetchImpl: (async () => kimiSseResponse([
          { choices: [{ delta: { content: 'partial' } }] },
        ], { includeDone: false })) as typeof fetch,
      },
    });

    await expect(adapter.chat([{ role: 'user', content: 'Hello' }], []))
      .rejects.toThrow('Kimi Platform stream ended before the [DONE] marker.');
  });
});

const addTool: ToolDefinition = {
  name: 'add',
  description: 'Add two numbers.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['a', 'b'],
  },
  execute: async () => ({ ok: true, output: 5 }),
};

function kimiSseResponse(
  payloads: unknown[],
  options: { fragmentSize?: number; includeDone?: boolean } = {},
): Response {
  const text = [
    ...payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`),
    ...(options.includeDone === false ? [] : ['data: [DONE]\n\n']),
  ].join('');
  const encoded = new TextEncoder().encode(text);
  const fragmentSize = options.fragmentSize ?? encoded.length;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += fragmentSize) {
        controller.enqueue(encoded.slice(offset, offset + fragmentSize));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}
