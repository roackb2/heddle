import { LlmUsageService } from '@/core/llm/usage/index.js';
import type { ChatMessage, LlmProvider, LlmUsage } from '@/core/llm/types.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';

type OpenAiCompatibleChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAiCompatibleToolCall[];
};

type OpenAiCompatibleToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAiCompatibleFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Wire codec for providers that implement the OpenAI-compatible
 * `/chat/completions` shape. Keep provider-family quirks here so the agent
 * loop and hosts only depend on Heddle's neutral chat/tool contracts.
 */
export class OpenAiCompatibleCodec {
  static toMessages(messages: ChatMessage[]): OpenAiCompatibleChatCompletionMessage[] {
    return messages.map((message) => {
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls?.map((call) => OpenAiCompatibleCodec.toToolCall(call)),
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

  static toTools(tools: ToolDefinition[]): OpenAiCompatibleFunctionTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  static extractContent(response: unknown): string | undefined {
    const content = OpenAiCompatibleCodec.firstMessage(response)?.content;
    return typeof content === 'string' && content.length > 0 ? content : undefined;
  }

  static extractToolCalls(response: unknown): ToolCall[] | undefined {
    const toolCalls = OpenAiCompatibleCodec.firstMessage(response)?.tool_calls;
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    const parsed = toolCalls.flatMap((call): ToolCall[] => {
      if (!call || typeof call !== 'object') {
        return [];
      }
      const entry = call as Partial<OpenAiCompatibleToolCall>;
      const id = typeof entry.id === 'string' ? entry.id : undefined;
      const name = typeof entry.function?.name === 'string' ? entry.function.name : undefined;
      const argumentsText = typeof entry.function?.arguments === 'string' ? entry.function.arguments : undefined;
      if (!id || !name || typeof argumentsText !== 'string') {
        return [];
      }

      return [{
        id,
        tool: name,
        input: argumentsText.trim() ? JSON.parse(argumentsText) : {},
      }];
    });

    return parsed.length > 0 ? parsed : undefined;
  }

  static extractUsage(
    response: unknown,
    attribution: { provider: LlmProvider; model: string },
  ): LlmUsage | undefined {
    if (!response || typeof response !== 'object') {
      return undefined;
    }

    const usage = (response as { usage?: unknown }).usage;
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }

    const inputTokens = OpenAiCompatibleCodec.numberField(usage, 'prompt_tokens') ?? 0;
    const outputTokens = OpenAiCompatibleCodec.numberField(usage, 'completion_tokens') ?? 0;
    return LlmUsageService.fromProviderRequest({
      provider: attribution.provider,
      model: OpenAiCompatibleCodec.stringField(response, 'model') ?? attribution.model,
      billedInputTokens: inputTokens,
      outputTokens,
      totalTokens: OpenAiCompatibleCodec.numberField(usage, 'total_tokens') ?? inputTokens + outputTokens,
    });
  }

  private static toToolCall(call: ToolCall): OpenAiCompatibleToolCall {
    return {
      id: call.id,
      type: 'function',
      function: {
        name: call.tool,
        arguments: JSON.stringify(call.input),
      },
    };
  }

  private static firstMessage(response: unknown): {
    content?: unknown;
    tool_calls?: unknown;
  } | undefined {
    if (!response || typeof response !== 'object') {
      return undefined;
    }

    const choices = (response as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) {
      return undefined;
    }

    const message = (choices[0] as { message?: unknown } | undefined)?.message;
    return message && typeof message === 'object' ? message : undefined;
  }

  private static numberField(value: object, key: string): number | undefined {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'number' ? field : undefined;
  }

  private static stringField(value: object, key: string): string | undefined {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' && field.trim() ? field : undefined;
  }
}
