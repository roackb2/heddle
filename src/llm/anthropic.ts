import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { LlmAdapter, ChatMessage, LlmResponse, LlmAdapterCapabilities, LlmUsage } from './types.js';
import type { ToolDefinition, ToolCall } from '../types.js';
import { DEFAULT_ANTHROPIC_MODEL } from '../config.js';

export type AnthropicAdapterOptions = {
  apiKey?: string;
  model?: string;
};

export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}): LlmAdapter {
  const client = new Anthropic({
    apiKey: firstDefinedNonEmpty(
      options.apiKey,
      process.env.ANTHROPIC_API_KEY,
      process.env.PERSONAL_ANTHROPIC_API_KEY,
    ),
  });
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const capabilities: LlmAdapterCapabilities = {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: false,
    parallelToolCalls: false,
  };

  return {
    info: {
      provider: 'anthropic',
      model,
      capabilities,
    },
    async chat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
      const system = messages
        .filter((message): message is Extract<ChatMessage, { role: 'system' }> => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');
      const anthropicMessages = toAnthropicMessages(messages);
      const response = await client.messages.create({
        model,
        system: system || undefined,
        messages: anthropicMessages,
        tools: tools.length > 0 ? tools.map(toAnthropicTool) : undefined,
        max_tokens: 4096,
      }, { signal });

      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
        .trim();
      const toolCalls = response.content.flatMap((block): ToolCall[] => {
        if (block.type !== 'tool_use') {
          return [];
        }

        return [{
          id: block.id,
          tool: block.name,
          input: block.input,
        }];
      });

      return {
        content: text || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: extractUsage(response.usage),
      };
    },
  };
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}

function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'system':
        break;
      case 'user':
        result.push({ role: 'user', content: message.content });
        break;
      case 'assistant': {
        const content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }> = [];
        if (message.content) {
          content.push({ type: 'text', text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          content.push({
            type: 'tool_use',
            id: call.id,
            name: call.tool,
            input: call.input,
          });
        }
        result.push({ role: 'assistant', content } as MessageParam);
        break;
      }
      case 'tool':
        result.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content,
          } satisfies ToolResultBlockParam],
        } as MessageParam);
        break;
    }
  }

  return result;
}

function toAnthropicTool(tool: ToolDefinition): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Tool['input_schema'],
  };
}

function extractUsage(usage: { input_tokens: number; output_tokens: number } | undefined): LlmUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    requests: 1,
  };
}
