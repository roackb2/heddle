import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatMessage, LlmUsage } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';

/**
 * Provider-owned codec for translating between Heddle LLM port types and the
 * Anthropic Messages API payloads.
 */
export class AnthropicCodec {
  static toMessages(messages: ChatMessage[]): MessageParam[] {
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

  static toTool(tool: ToolDefinition): Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Tool['input_schema'],
    };
  }

  static extractUsage(usage: { input_tokens: number; output_tokens: number } | undefined): LlmUsage | undefined {
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
}
