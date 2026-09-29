import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';
import { LlmUsageService } from '@/core/llm/usage/index.js';
import type { ChatMessage, LlmUsage, ReasoningEffort } from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import { AnthropicReplayBlocksSchema } from './anthropic-continuation.js';

/**
 * Provider-owned codec for translating between Heddle LLM port types and the
 * Anthropic Messages API payloads.
 */
export class AnthropicCodec {
  static toReasoningEffort(effort: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
    if (effort === 'none') {
      throw new Error('Claude does not support none reasoning effort.');
    }

    return effort === 'ultrahigh' ? 'xhigh' : effort;
  }

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
          if (message.providerContinuation?.provider === 'anthropic') {
            const contentBlocks = AnthropicReplayBlocksSchema.parse(message.providerContinuation.contentBlocks);
            const replayedToolIds = contentBlocks.flatMap((block) => block.type === 'tool_use' ? [block.id] : []);
            const toolIds = (message.toolCalls ?? []).map((call) => call.id);
            if (replayedToolIds.length !== toolIds.length || replayedToolIds.some((id, index) => id !== toolIds[index])) {
              throw new Error('Claude continuation no longer matches the assistant tool calls.');
            }

            result.push({ role: 'assistant', content: contentBlocks as ContentBlockParam[] });
            break;
          }

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

  static extractUsage(usage: Usage | undefined, model: string): LlmUsage | undefined {
    if (!usage) {
      return undefined;
    }

    return LlmUsageService.fromProviderRequest({
      provider: 'anthropic',
      model,
      billedInputTokens: usage.input_tokens,
      cachedInputTokens: usage.cache_read_input_tokens ?? undefined,
      cacheWriteInputTokens: usage.cache_creation_input_tokens ?? undefined,
      outputTokens: usage.output_tokens,
    });
  }
}
