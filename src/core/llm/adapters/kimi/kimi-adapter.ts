import {
  createParser,
  type EventSourceMessage,
} from 'eventsource-parser';
import type {
  ChatMessage,
  LlmAdapter,
  LlmAdapterCreateInput,
  LlmResponse,
  LlmStreamEvent,
  ReasoningEffort,
} from '@/core/llm/types.js';
import { OpenAiCompatibleModelName } from '@/core/llm/adapters/openai-compatible/openai-compatible-model.js';
import type { OpenAiCompatibleProviderProfile } from '@/core/llm/adapters/openai-compatible/types.js';
import type { ToolDefinition } from '@/core/types.js';
import { KimiCodec } from './kimi-codec.js';
import { KimiChatCompletionsStreamDecoder } from './kimi-stream-decoder.js';

export type KimiAdapterOptions = LlmAdapterCreateInput & {
  provider: 'kimi';
  model: string;
  profile: OpenAiCompatibleProviderProfile;
};

const KIMI_REASONING_EFFORTS = new Set<ReasoningEffort>(['low', 'high', 'max']);

/**
 * Kimi Platform chat-completions adapter.
 *
 * Kimi's preserved-thinking protocol requires streaming and exact replay of
 * `reasoning_content`, so it intentionally does not use the generic
 * OpenAI-compatible adapter even though it shares the endpoint envelope.
 */
export class KimiAdapter implements LlmAdapter {
  readonly info;

  private readonly model: string;
  private readonly endpointBaseUrl: string;
  private readonly apiKey: string;
  private readonly reasoningEffort?: 'low' | 'high' | 'max';
  private readonly fetcher: (url: unknown, init?: unknown) => Promise<globalThis.Response>;

  constructor(options: KimiAdapterOptions) {
    const endpoint = options.runtime?.endpoint;
    if (!endpoint) {
      throw new Error('Missing Kimi Platform endpoint runtime. Resolve provider runtime before creating the adapter.');
    }
    if (endpoint.auth.type !== 'bearer' || !endpoint.auth.token.trim()) {
      throw new Error('Kimi Platform endpoint requires bearer API-key auth.');
    }

    this.model = OpenAiCompatibleModelName.toProviderModel(options.profile, options.model);
    this.endpointBaseUrl = endpoint.baseUrl.replace(/\/+$/, '');
    this.apiKey = endpoint.auth.token;
    this.reasoningEffort = KimiAdapter.resolveReasoningEffort(options.runtime?.reasoningEffort);
    this.fetcher = options.runtime?.fetchImpl
      ?? (fetch as (url: unknown, init?: unknown) => Promise<globalThis.Response>);
    this.info = {
      provider: 'kimi',
      model: OpenAiCompatibleModelName.toHeddleModel(options.profile, this.model),
      capabilities: options.profile.capabilities,
    } satisfies LlmAdapter['info'];
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    onStreamEvent?: (event: LlmStreamEvent) => void,
  ): Promise<LlmResponse> {
    const response = await this.fetcher(`${this.endpointBaseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: KimiCodec.toMessages(messages),
        tools: tools.length > 0 ? KimiCodec.toTools(tools) : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        reasoning_effort: this.reasoningEffort,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Kimi Platform chat-completions request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
    }
    if (!response.body) {
      throw new Error('Kimi Platform chat-completions response did not include a readable body.');
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'text/event-stream') {
      throw new Error('Kimi Platform chat-completions response was not an SSE stream.');
    }

    return await KimiAdapter.consumeEventStream(response.body, onStreamEvent);
  }

  private static async consumeEventStream(
    body: ReadableStream<Uint8Array>,
    onStreamEvent?: (event: LlmStreamEvent) => void,
  ): Promise<LlmResponse> {
    const pending: EventSourceMessage[] = [];
    const parser = createParser({
      onEvent: (event) => pending.push(event),
      onError: (error) => {
        throw new Error('Kimi Platform returned invalid SSE framing.', { cause: error });
      },
    });
    const stream = new KimiChatCompletionsStreamDecoder(onStreamEvent);
    const reader = body.getReader();
    const textDecoder = new TextDecoder();
    let completed = false;

    const flushPending = () => {
      while (pending.length > 0) {
        const message = pending.shift();
        if (message) {
          stream.accept(message.data);
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          parser.feed(textDecoder.decode());
          parser.reset({ consume: true });
          flushPending();
          const result = stream.finish();
          completed = true;
          return result;
        }
        parser.feed(textDecoder.decode(value, { stream: true }));
        flushPending();
      }
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }
  }

  private static resolveReasoningEffort(effort: ReasoningEffort | undefined): 'low' | 'high' | 'max' | undefined {
    if (effort === undefined) {
      return undefined;
    }
    if (!KIMI_REASONING_EFFORTS.has(effort)) {
      throw new Error(`Kimi K3 reasoning effort must be low, high, or max; received ${effort}.`);
    }
    return effort as 'low' | 'high' | 'max';
  }
}
