import Anthropic from '@anthropic-ai/sdk';
import type { LlmAdapter, ChatMessage, LlmResponse, LlmAdapterCapabilities, LlmAdapterCreateInput } from '@/core/llm/types.js';
import type { ToolDefinition, ToolCall } from '@/core/types.js';
import { DEFAULT_ANTHROPIC_MODEL } from '@/core/config.js';
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

  constructor(options: AnthropicAdapterOptions = {}) {
    this.client = new Anthropic({
      apiKey: AnthropicAdapter.firstDefinedNonEmpty(
        options.credentials?.apiKey,
        process.env.ANTHROPIC_API_KEY,
        process.env.PERSONAL_ANTHROPIC_API_KEY,
      ),
    });
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
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
    const response = await this.client.messages.create({
      model: this.model,
      system: system || undefined,
      messages: anthropicMessages,
      tools: tools.length > 0 ? tools.map((tool) => AnthropicCodec.toTool(tool)) : undefined,
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
      usage: AnthropicCodec.extractUsage(response.usage),
    };
  }

  private static firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0);
  }
}
