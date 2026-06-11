import type { ChatMessage, LlmUsage } from '@/core/llm/types.js';
import type { ToolCall, ToolDefinition } from '@/core/types.js';

type OllamaChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OllamaToolCall[];
};

type OllamaToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type OllamaFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Provider-owned codec for Ollama's OpenAI-compatible chat completions API.
 * Keep request/response quirks here so the agent loop only sees Heddle's
 * provider-neutral ChatMessage, ToolDefinition, ToolCall, and LlmUsage types.
 */
export class OllamaCodec {
  static toMessages(messages: ChatMessage[]): OllamaChatCompletionMessage[] {
    return messages.map((message) => {
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls?.map((call) => OllamaCodec.toToolCall(call)),
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

  static toTools(tools: ToolDefinition[]): OllamaFunctionTool[] {
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
    const content = OllamaCodec.firstMessage(response)?.content;
    return typeof content === 'string' && content.length > 0 ? content : undefined;
  }

  static extractToolCalls(response: unknown): ToolCall[] | undefined {
    const toolCalls = OllamaCodec.firstMessage(response)?.tool_calls;
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    const parsed = toolCalls.flatMap((call): ToolCall[] => {
      if (!call || typeof call !== 'object') {
        return [];
      }
      const entry = call as Partial<OllamaToolCall>;
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

  static extractUsage(response: unknown): LlmUsage | undefined {
    if (!response || typeof response !== 'object') {
      return undefined;
    }

    const usage = (response as { usage?: unknown }).usage;
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }

    const inputTokens = OllamaCodec.numberField(usage, 'prompt_tokens') ?? 0;
    const outputTokens = OllamaCodec.numberField(usage, 'completion_tokens') ?? 0;
    return {
      inputTokens,
      outputTokens,
      totalTokens: OllamaCodec.numberField(usage, 'total_tokens') ?? inputTokens + outputTokens,
      requests: 1,
    };
  }

  private static toToolCall(call: ToolCall): OllamaToolCall {
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
}
