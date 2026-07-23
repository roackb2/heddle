import type {
  FunctionTool,
  Response as OpenAiResponse,
  ResponseIncludable,
  ResponseInputItem,
  ResponseReasoningItem,
} from 'openai/resources/responses/responses.js';
import type { ReasoningEffort as OpenAiReasoningEffort } from 'openai/resources/shared.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import { LlmUsageService } from '@/core/llm/usage/index.js';
import type { ChatMessage, LlmUsage, ReasoningEffort } from '@/core/llm/types.js';
import type { AssistantDiagnostics, ToolCall, ToolDefinition } from '@/core/types.js';

export type OpenAiAssistantMessagePhase = 'commentary' | 'final_answer';
export type OpenAiAssistantMessageMetadata = {
  messageId: string;
  phase?: OpenAiAssistantMessagePhase;
};

const OPENAI_ACCOUNT_COMMENTARY_INSTRUCTIONS = `During substantial multi-step work, keep the user informed with brief, concrete commentary messages before tool calls and between major phases. Describe progress and the next action without revealing hidden chain-of-thought. Skip commentary for simple one-step answers.`;

/**
 * Provider-owned codec for translating between Heddle LLM port types and the
 * OpenAI Responses API payloads/events.
 */
export class OpenAiCodec {
  /**
   * Reads the Responses/Codex assistant-message discriminator.
   *
   * A completed assistant output item has this relevant shape:
   *
   * ```ts
   * {
   *   id: 'msg_123',
   *   type: 'message',
   *   role: 'assistant',
   *   phase: 'commentary' | 'final_answer',
   *   content: [{ type: 'output_text', text: '...' }],
   * }
   * ```
   *
   * `phase` is the classifier: `phase: 'commentary'` means user-facing work
   * narration, not hidden chain-of-thought and not the final answer. The text
   * still lives in `content[].output_text.text`. Standard Responses API output
   * may omit `phase`; preserving `undefined` lets callers use the normal final
   * output fallback without guessing from message wording or ordering.
   */
  static readAssistantMessageMetadata(item: unknown): OpenAiAssistantMessageMetadata | undefined {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return undefined;
    }

    const candidate = item as { id?: unknown; type?: unknown; role?: unknown; phase?: unknown };
    if (
      candidate.type !== 'message'
      || candidate.role !== 'assistant'
      || typeof candidate.id !== 'string'
    ) {
      return undefined;
    }

    return {
      messageId: candidate.id,
      ...(candidate.phase === 'commentary' || candidate.phase === 'final_answer'
        ? { phase: candidate.phase }
        : {}),
    };
  }

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
    const output = Array.isArray(response.output) ? response.output : [];
    const messages = output.flatMap((item) => {
      const metadata = OpenAiCodec.readAssistantMessageMetadata(item);
      if (!metadata || item.type !== 'message') {
        return [];
      }

      const text = (Array.isArray(item.content) ? item.content : [])
        .flatMap((part) => part.type === 'output_text' && part.text.trim() ? [part.text.trim()] : [])
        .join('\n\n');
      return text ? [{ ...metadata, text }] : [];
    });

    if (preferToolCalls) {
      const progressText = messages
        .filter((message) => message.phase !== 'final_answer')
        .map((message) => message.text)
        .join('\n\n');
      return progressText || undefined;
    }

    const finalText = messages.find((message) => message.phase === 'final_answer')?.text
      ?? messages.find((message) => message.phase === undefined)?.text;
    return finalText ?? (response.output_text?.trim() || undefined);
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

    const cachedInputTokens = usage.input_tokens_details?.cached_tokens;
    return LlmUsageService.fromProviderRequest({
      provider: 'openai',
      model: response.model,
      billedInputTokens: Math.max(usage.input_tokens - (cachedInputTokens ?? 0), 0),
      cachedInputTokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
    });
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
    include?: ResponseIncludable[];
    reasoning?: { summary: 'auto' | 'detailed'; effort?: OpenAiReasoningEffort };
    instructions?: string;
  } {
    const systemMessages = options.oauthMode ? messages.filter((message): message is Extract<ChatMessage, { role: 'system' }> => message.role === 'system') : [];
    const inputMessages = options.oauthMode ? messages.filter((message) => message.role !== 'system') : messages;
    const instructions = options.oauthMode
      ? [
          ...systemMessages.map((message) => message.content.trim()).filter(Boolean),
          OPENAI_ACCOUNT_COMMENTARY_INSTRUCTIONS,
        ].join('\n\n')
      : undefined;
    const reasoningEffort = OpenAiCodec.resolveRequestReasoningEffort({
      model: options.model,
      explicitEffort: options.reasoningEffort,
    });
    // Summary support and configurable effort are independent capabilities.
    // Non-reasoning API-key models (e.g. gpt-4.1) reject the entire block,
    // while established reasoning models may support summaries without a
    // Heddle-managed effort setting.
    const includeReasoning =
      options.oauthMode ||
      Boolean(reasoningEffort) ||
      ModelPolicyService.supportsOpenAiReasoningSummary(options.model);

    return {
      model: options.model,
      input: OpenAiCodec.toResponseInput(inputMessages),
      tools: options.tools.length > 0 ? options.tools.map((tool) => OpenAiCodec.toResponseTool(tool)) : undefined,
      store: false,
      ...(options.oauthMode && includeReasoning ? {
        // Codex account-mode summary events require the encrypted reasoning
        // item to be requested alongside the user-visible summary.
        include: ['reasoning.encrypted_content' as const],
      } : {}),
      ...(includeReasoning ? {
        reasoning: {
          // Request a summary explicitly for every supported credential path.
          // `auto` may return no user-visible summary even when the model spent
          // reasoning tokens, which leaves embedded hosts with no live progress.
          summary: 'detailed' as const,
          ...(reasoningEffort ? { effort: reasoningEffort } : {}),
        },
      } : {}),
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
    // Heddle persisted `ultrahigh` before OpenAI standardized the provider
    // wire value as `xhigh`. Keep the product value backward compatible and
    // translate only at this provider-owned boundary.
    return value === 'ultrahigh' ? 'xhigh' : value;
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
