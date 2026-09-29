import Anthropic from '@anthropic-ai/sdk';
import type { LlmAdapter, ChatMessage, LlmResponse, LlmAdapterCapabilities, LlmAdapterCreateInput, ReasoningEffort } from '@/core/llm/types.js';
import type { ToolDefinition, ToolCall } from '@/core/types.js';
import { DEFAULT_ANTHROPIC_MODEL } from '@/core/config.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import { AnthropicReplayBlocksSchema } from './anthropic-continuation.js';
import { AnthropicCodec } from './anthropic-codec.js';

export type AnthropicAdapterOptions = LlmAdapterCreateInput;

/**
 * Anthropic implementation of the LLM port. It owns Claude message/tool
 * conversion while exposing the provider-neutral LlmAdapter contract.
 */
export class AnthropicAdapter implements LlmAdapter {
  private static readonly capabilities: LlmAdapterCapabilities = {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: false,
    parallelToolCalls: false,
  };

  readonly info;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly reasoningEffort?: ReasoningEffort;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.client = new Anthropic({
      apiKey: AnthropicAdapter.firstDefinedNonEmpty(
        options.credentials?.apiKey,
        process.env.ANTHROPIC_API_KEY,
        process.env.PERSONAL_ANTHROPIC_API_KEY,
      ),
      fetch: options.runtime?.fetchImpl,
    });
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.reasoningEffort = options.runtime?.reasoningEffort ?? ModelPolicyService.resolveDefaultReasoningEffort(this.model);
    if (this.reasoningEffort && !ModelPolicyService.supportedRequestReasoningEfforts(this.model).includes(this.reasoningEffort)) {
      throw new Error(`Reasoning effort "${this.reasoningEffort}" is not supported for Anthropic model ${this.model}.`);
    }
    this.info = {
      provider: 'anthropic',
      model: this.model,
      capabilities: AnthropicAdapter.capabilities,
    } satisfies LlmAdapter['info'];
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
    const system = messages
      .filter((message): message is Extract<ChatMessage, { role: 'system' }> => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const anthropicMessages = AnthropicCodec.toMessages(messages);
    const response = await this.client.messages.stream({
      model: this.model,
      system: system || undefined,
      messages: anthropicMessages,
      tools: tools.length > 0 ? tools.map((tool) => AnthropicCodec.toTool(tool)) : undefined,
      max_tokens: ModelPolicyService.resolveAnthropicMaxTokens(this.model, this.reasoningEffort),
      ...(this.reasoningEffort ? { output_config: { effort: AnthropicCodec.toReasoningEffort(this.reasoningEffort) } } : {}),
    }, { signal }).finalMessage();

    if (response.stop_reason === 'max_tokens') {
      throw new Error(`Claude response reached max_tokens before completing for model ${this.model}.`);
    }

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
      ...(toolCalls.length > 0 ? {
        providerContinuation: {
          provider: 'anthropic' as const,
          contentBlocks: AnthropicReplayBlocksSchema.parse(response.content),
        },
      } : {}),
      usage: AnthropicCodec.extractUsage(response.usage, response.model),
    };
  }

  private static firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0);
  }
}
