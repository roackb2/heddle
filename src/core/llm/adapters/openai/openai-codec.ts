import type {
  FunctionTool,
  Response as OpenAiResponse,
  ResponseInputItem,
  ResponseReasoningItem,
} from 'openai/resources/responses/responses.js';
import type { ReasoningEffort as OpenAiReasoningEffort } from 'openai/resources/shared.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import type { ChatMessage, LlmUsage, ReasoningEffort } from '@/core/llm/types.js';
import type { AssistantDiagnostics, ToolCall, ToolDefinition } from '@/core/types.js';

/**
 * Provider-owned codec for translating between Heddle LLM port types and the
 * OpenAI Responses API payloads/events.
 */
export class OpenAiCodec {
  static parseStreamedToolCalls(
    streamedToolCalls: Map<string, { id: string; tool: string; argumentsText: string }>,
  ): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const entry of streamedToolCalls.values()) {
      if (!entry.argumentsText.trim()) {
        continue;
      }

      toolCalls.push({
        id: entry.id,
        tool: entry.tool,
        input: JSON.parse(entry.argumentsText),
      });
    }

    return toolCalls;
  }

  static readReasoningSummaryDeltaText(delta: unknown): string | undefined {
    if (typeof delta === 'string') {
      return delta;
    }

    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
      return undefined;
    }

    const text = (delta as { text?: unknown }).text;
    return typeof text === 'string' ? text : undefined;
  }

  static extractAssistantContent(response: OpenAiResponse, preferToolCalls: boolean): string | undefined {
    const text = response.output_text?.trim();
    if (text) {
      return text;
    }

    if (preferToolCalls) {
      return undefined;
    }

    const output = Array.isArray(response.output) ? response.output : [];
    for (const item of output) {
      if (item.type !== 'message') {
        continue;
      }

      const content = Array.isArray(item.content) ? item.content : [];
      const segment = content.find((part) => part.type === 'output_text');
      if (segment?.text?.trim()) {
        return segment.text.trim();
      }
    }

    return undefined;
  }

  static extractAssistantDiagnostics(
    response: OpenAiResponse,
    preferToolCalls: boolean,
  ): AssistantDiagnostics | undefined {
    const output = Array.isArray(response.output) ? response.output : [];
    const reasoning = output.find((item): item is ResponseReasoningItem => item.type === 'reasoning');
    if (!reasoning || !Array.isArray(reasoning.summary)) {
      return undefined;
    }

    const rationale = reasoning.summary
      .map((summary) => summary.type === 'summary_text' ? summary.text.trim() : '')
      .find(Boolean);
    if (!rationale) {
      return undefined;
    }

    if (preferToolCalls) {
      return { rationale };
    }

    return {
      rationale,
    };
  }

  static extractUsage(response: OpenAiResponse): LlmUsage | undefined {
    const usage = response.usage;
    if (!usage) {
      return undefined;
    }

    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
      requests: 1,
    };
  }

  static buildResponsesRequest(
    messages: ChatMessage[],
    options: {
      model: string;
      tools: ToolDefinition[];
      oauthMode: boolean;
      reasoningEffort?: ReasoningEffort;
    },
  ): {
    model: string;
    input: ResponseInputItem[];
    tools?: FunctionTool[];
    store: boolean;
    reasoning: { summary: 'auto' | 'detailed'; effort?: OpenAiReasoningEffort };
    instructions?: string;
  } {
    const systemMessages = options.oauthMode ? messages.filter((message): message is Extract<ChatMessage, { role: 'system' }> => message.role === 'system') : [];
    const inputMessages = options.oauthMode ? messages.filter((message) => message.role !== 'system') : messages;
    const instructions =
      options.oauthMode ?
        systemMessages.map((message) => message.content.trim()).filter(Boolean).join('\n\n')
      : undefined;
    const reasoningEffort = OpenAiCodec.resolveRequestReasoningEffort({
      model: options.model,
      explicitEffort: options.reasoningEffort,
    });

    return {
      model: options.model,
      input: OpenAiCodec.toResponseInput(inputMessages),
      tools: options.tools.length > 0 ? options.tools.map((tool) => OpenAiCodec.toResponseTool(tool)) : undefined,
      store: false,
      reasoning: {
        summary: options.oauthMode ? 'auto' : 'detailed',
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      },
      ...(instructions ? { instructions } : {}),
    };
  }

  private static resolveRequestReasoningEffort(args: {
    model: string;
    explicitEffort?: ReasoningEffort;
  }): OpenAiReasoningEffort | undefined {
    const effectiveEffort = args.explicitEffort ?? ModelPolicyService.resolveDefaultReasoningEffort(args.model);
    if (!effectiveEffort) {
      return undefined;
    }

    if (!ModelPolicyService.supportsOpenAiRequestReasoningEffortLevel(args.model, effectiveEffort)) {
      if (args.explicitEffort) {
        throw new Error(`Reasoning effort "${effectiveEffort}" is not supported for OpenAI model ${args.model}.`);
      }
      return undefined;
    }

    return OpenAiCodec.toOpenAiReasoningEffort(effectiveEffort);
  }

  private static toOpenAiReasoningEffort(value: ReasoningEffort): OpenAiReasoningEffort {
    return value as OpenAiReasoningEffort;
  }

  private static toResponseInput(messages: ChatMessage[]): ResponseInputItem[] {
    return messages.flatMap((message) => OpenAiCodec.toResponseInputItems(message));
  }

  private static toResponseInputItems(msg: ChatMessage): ResponseInputItem[] {
    switch (msg.role) {
      case 'system':
        return [{ type: 'message', role: 'system', content: msg.content }];
      case 'user':
        return [{ type: 'message', role: 'user', content: msg.content }];
      case 'assistant': {
        const items: ResponseInputItem[] = [];
        if (msg.content) {
          items.push({ type: 'message', role: 'assistant', content: msg.content });
        }
        if (msg.toolCalls) {
          for (const call of msg.toolCalls) {
            items.push({
              type: 'function_call',
              call_id: call.id,
              name: call.tool,
              arguments: JSON.stringify(call.input),
            });
          }
        }
        return items;
      }
      case 'tool':
        return [
          {
            type: 'function_call_output',
            call_id: msg.toolCallId,
            output: msg.content,
          },
        ];
    }
  }

  private static toResponseTool(tool: ToolDefinition): FunctionTool {
    return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    };
  }
}
