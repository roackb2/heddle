import type {
  ChatMessage,
  LlmUsage,
} from '@/core/llm/types.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';

type KimiChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: KimiToolCall[];
};

type KimiToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type KimiFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: false;
  };
};

export type KimiAccumulatedToolCall = {
  index: number;
  id: string;
  name: string;
  argumentsText: string;
};

/**
 * Owns Kimi Platform wire translation, including preserved-thinking replay.
 * Raw `reasoning_content` is provider-private continuation state; this codec
 * never projects it into Heddle's user-facing reasoning-summary events.
 */
export class KimiCodec {
  static toMessages(messages: ChatMessage[]): KimiChatCompletionMessage[] {
    return messages.map((message) => {
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content || null,
          ...(message.providerContinuation?.provider === 'kimi' ? {
            reasoning_content: message.providerContinuation.reasoningContent,
          } : {}),
          tool_calls: message.toolCalls?.map((call) => KimiCodec.toToolCall(call)),
        };
      }

      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.toolCallId,
        };
      }

      return {
        role: message.role,
        content: message.content,
      };
    });
  }

  static toTools(tools: ToolDefinition[]): KimiFunctionTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
      },
    }));
  }

  static parseToolCalls(calls: KimiAccumulatedToolCall[]): ToolCall[] | undefined {
    const parsed = calls
      .sort((left, right) => left.index - right.index)
      .map((call) => {
        if (!call.id || !call.name) {
          throw new Error(`Kimi Platform returned an incomplete tool call at index ${call.index}.`);
        }

        let input: unknown = {};
        if (call.argumentsText.trim()) {
          try {
            input = JSON.parse(call.argumentsText);
          } catch (error) {
            throw new Error(`Kimi Platform returned invalid JSON arguments for tool ${call.name}.`, {
              cause: error,
            });
          }
        }

        return {
          id: call.id,
          tool: call.name,
          input,
        } satisfies ToolCall;
      });

    return parsed.length > 0 ? parsed : undefined;
  }

  static extractUsage(value: unknown): LlmUsage | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const usage = (value as { usage?: unknown }).usage;
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }

    const inputTokens = KimiCodec.numberField(usage, 'prompt_tokens') ?? 0;
    const outputTokens = KimiCodec.numberField(usage, 'completion_tokens') ?? 0;
    const promptDetails = KimiCodec.objectField(usage, 'prompt_tokens_details');
    const completionDetails = KimiCodec.objectField(usage, 'completion_tokens_details');

    return {
      inputTokens,
      outputTokens,
      totalTokens: KimiCodec.numberField(usage, 'total_tokens') ?? inputTokens + outputTokens,
      cachedInputTokens: promptDetails ? KimiCodec.numberField(promptDetails, 'cached_tokens') : undefined,
      reasoningTokens: completionDetails ? KimiCodec.numberField(completionDetails, 'reasoning_tokens') : undefined,
      requests: 1,
    };
  }

  private static toToolCall(call: ToolCall): KimiToolCall {
    return {
      id: call.id,
      type: 'function',
      function: {
        name: call.tool,
        arguments: JSON.stringify(call.input),
      },
    };
  }

  private static objectField(value: object, key: string): object | undefined {
    const field = (value as Record<string, unknown>)[key];
    return field && typeof field === 'object' ? field : undefined;
  }

  private static numberField(value: object, key: string): number | undefined {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'number' ? field : undefined;
  }
}
