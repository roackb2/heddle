import { describe, expect, it } from 'vitest';
import { AnthropicAdapter } from '@/core/llm/adapters/anthropic/index.js';
import type { ToolDefinition } from '@/core/types.js';

const addTool: ToolDefinition = {
  name: 'add',
  description: 'Add two numbers.',
  parameters: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  execute: async () => ({ ok: true, output: 5 }),
};

const toolBlocks = [
  { type: 'thinking', thinking: '', signature: 'private-signed-thinking' },
  { type: 'text', text: 'I will use add.', citations: null },
  { type: 'tool_use', id: 'call-1', name: 'add', input: { a: 2, b: 3 } },
];

const anthropicResponse = (content: unknown[], stopReason: string, model = 'claude-sonnet-5-5') => {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg-test', type: 'message', role: 'assistant', model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    ...content.flatMap((contentBlock, index) => {
      if (contentBlock && typeof contentBlock === 'object' && 'type' in contentBlock && contentBlock.type === 'thinking'
        && 'signature' in contentBlock && typeof contentBlock.signature === 'string') {
        return [
          { type: 'content_block_start', index, content_block: { ...contentBlock, signature: '' } },
          { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: contentBlock.signature } },
          { type: 'content_block_stop', index },
        ];
      }

      return [
        { type: 'content_block_start', index, content_block: contentBlock },
        { type: 'content_block_stop', index },
      ];
    }),
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ];

  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

describe('AnthropicAdapter Claude 5', () => {
  it('replays exact signed thinking blocks with tool results without exposing them as text', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      anthropicResponse(toolBlocks, 'tool_use'),
      anthropicResponse([{ type: 'text', text: 'The answer is 5.', citations: null }], 'end_turn'),
    ];
    const adapter = new AnthropicAdapter({
      model: 'claude-sonnet-5-5',
      credentials: { apiKey: 'test-key' },
      runtime: {
        reasoningEffort: 'ultrahigh',
        fetchImpl: async (_url, init) => {
          requests.push(JSON.parse(String((init as RequestInit).body)));
          const response = responses.shift();
          if (!response) throw new Error('Unexpected Claude request.');
          return response;
        },
      },
    });

    const toolRequest = await adapter.chat([{ role: 'user', content: 'Add 2 and 3.' }], [addTool]);

    expect(toolRequest.content).toBe('I will use add.');
    expect(toolRequest.toolCalls).toEqual([{ id: 'call-1', tool: 'add', input: { a: 2, b: 3 } }]);
    expect(toolRequest.providerContinuation).toEqual({ provider: 'anthropic', contentBlocks: toolBlocks });

    const answer = await adapter.chat([
      { role: 'user', content: 'Add 2 and 3.' },
      {
        role: 'assistant',
        content: toolRequest.content ?? '',
        toolCalls: toolRequest.toolCalls,
        providerContinuation: toolRequest.providerContinuation,
      },
      { role: 'tool', toolCallId: 'call-1', content: '5' },
    ], [addTool]);

    expect(requests[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 64_000,
      output_config: { effort: 'xhigh' },
    });
    expect(requests[1]?.messages).toEqual([
      { role: 'user', content: 'Add 2 and 3.' },
      { role: 'assistant', content: toolBlocks },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '5' }] },
    ]);
    expect(answer.content).toBe('The answer is 5.');
    expect(answer.providerContinuation).toBeUndefined();
  });

  it('groups multiple tool results after exact signed-thinking replay', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const multiToolBlocks = [
      { type: 'thinking', thinking: '', signature: 'signed-thinking' },
      { type: 'tool_use', id: 'call-1', name: 'add', input: { a: 1, b: 2 } },
      { type: 'tool_use', id: 'call-2', name: 'add', input: { a: 3, b: 4 } },
    ];
    const responses = [
      anthropicResponse(multiToolBlocks, 'tool_use'),
      anthropicResponse([{ type: 'text', text: 'Both done.', citations: null }], 'end_turn'),
    ];
    const adapter = new AnthropicAdapter({
      model: 'claude-sonnet-5-5',
      credentials: { apiKey: 'test-key' },
      runtime: { fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String((init as RequestInit).body)));
        const response = responses.shift();
        if (!response) throw new Error('Unexpected Claude request.');
        return response;
      } },
    });

    expect(adapter.info.capabilities.parallelToolCalls).toBe(true);
    const first = await adapter.chat([{ role: 'user', content: 'Calculate both.' }], [addTool]);
    expect(first.toolCalls?.map((call) => call.id)).toEqual(['call-1', 'call-2']);
    await adapter.chat([
      { role: 'user', content: 'Calculate both.' },
      { role: 'assistant', content: '', toolCalls: first.toolCalls, providerContinuation: first.providerContinuation },
      { role: 'tool', toolCallId: 'call-1', content: '3' },
      { role: 'tool', toolCallId: 'call-2', content: '7' },
    ], [addTool]);
    expect(requests[1]?.messages).toEqual([
      { role: 'user', content: 'Calculate both.' },
      { role: 'assistant', content: multiToolBlocks },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call-1', content: '3' },
        { type: 'tool_result', tool_use_id: 'call-2', content: '7' },
      ] },
    ]);
  });

  it('rejects unsupported effort and incomplete capped responses', async () => {
    expect(() => new AnthropicAdapter({
      model: 'claude-opus-5-5',
      credentials: { apiKey: 'test-key' },
      runtime: { reasoningEffort: 'none' },
    })).toThrow('Reasoning effort "none" is not supported for Anthropic model claude-opus-5-5.');

    const adapter = new AnthropicAdapter({
      model: 'claude-sonnet-5-5',
      credentials: { apiKey: 'test-key' },
      runtime: { fetchImpl: async () => anthropicResponse([
        { type: 'thinking', thinking: '', signature: 'private-signed-thinking' },
      ], 'max_tokens') },
    });

    await expect(adapter.chat([{ role: 'user', content: 'Hello.' }], []))
      .rejects.toThrow('Claude response reached max_tokens before completing for model claude-sonnet-5-5.');
  });

  it('keeps older Claude requests free of Claude 5 effort settings', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const adapter = new AnthropicAdapter({
      model: 'claude-sonnet-4-6',
      credentials: { apiKey: 'test-key' },
      runtime: {
        fetchImpl: async (_url, init) => {
          requests.push(JSON.parse(String((init as RequestInit).body)));
          return anthropicResponse([{ type: 'text', text: 'OK', citations: null }], 'end_turn', 'claude-sonnet-4-6');
        },
      },
    });

    expect((await adapter.chat([{ role: 'user', content: 'Hello.' }], [])).content).toBe('OK');
    expect(requests[0]).toMatchObject({ model: 'claude-sonnet-4-6', max_tokens: 4_096 });
    expect(requests[0]).not.toHaveProperty('output_config');
  });
});
