// ---------------------------------------------------------------------------
// LLM Adapter — OpenAI implementation
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';
import type { LlmAdapter, ChatMessage, LlmResponse } from './types.js';
import type { ToolDefinition, ToolCall } from '../types.js';

export type OpenAiAdapterOptions = {
  apiKey?: string;
  model?: string;
};

/**
 * Create an LLM adapter backed by the OpenAI chat completions API.
 */
export function createOpenAiAdapter(options: OpenAiAdapterOptions = {}): LlmAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
  });
  const model = options.model ?? 'gpt-4o';

  return {
    async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
      const openaiMessages = messages.map(toOpenAiMessage);
      const openaiTools = tools.length > 0 ? tools.map(toOpenAiTool) : undefined;

      const response = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: openaiTools,
      });

      const choice = response.choices[0];
      if (!choice) {
        return { content: '' };
      }

      const content = choice.message.content ?? undefined;
      const toolCalls = choice.message.tool_calls?.map(
        (tc): ToolCall => ({
          id: tc.id,
          tool: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        }),
      );

      return { content, toolCalls };
    },
  };
}

// ---------------------------------------------------------------------------
// Internal converters
// ---------------------------------------------------------------------------

function toOpenAiMessage(msg: ChatMessage): ChatCompletionMessageParam {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content };
    case 'user':
      return { role: 'user', content: msg.content };
    case 'assistant': {
      const toolCalls = msg.toolCalls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.tool,
          arguments: JSON.stringify(tc.input),
        },
      }));
      return {
        role: 'assistant',
        content: msg.content,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    }
    case 'tool':
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      };
  }
}

function toOpenAiTool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
