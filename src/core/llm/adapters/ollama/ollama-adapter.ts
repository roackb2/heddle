import type {
  ChatMessage,
  LlmAdapter,
  LlmAdapterCapabilities,
  LlmAdapterCreateInput,
  LlmProviderEndpointAuth,
  LlmResponse,
  LlmStreamEvent,
} from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import { OllamaCodec } from './ollama-codec.js';
import { OllamaModelName } from './ollama-model.js';

export type OllamaAdapterOptions = LlmAdapterCreateInput & {
  provider: 'ollama';
  model: string;
};

/**
 * Ollama implementation of the LLM port using Ollama's OpenAI-compatible
 * `/chat/completions` endpoint. Runtime code must pass the resolved endpoint;
 * this adapter only translates Heddle messages/tools to provider HTTP.
 */
export class OllamaAdapter implements LlmAdapter {
  private static readonly capabilities: LlmAdapterCapabilities = {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: false,
    parallelToolCalls: false,
  };

  readonly info;

  private readonly model: string;
  private readonly displayModel: string;
  private readonly endpointBaseUrl: string;
  private readonly endpointAuth: LlmProviderEndpointAuth;
  private readonly fetcher: (url: unknown, init?: unknown) => Promise<globalThis.Response>;

  constructor(options: OllamaAdapterOptions) {
    const endpoint = options.runtime?.endpoint;
    if (!endpoint) {
      throw new Error('Missing Ollama endpoint runtime. Resolve provider runtime before creating the Ollama adapter.');
    }

    this.model = OllamaModelName.toProviderModel(options.model);
    this.displayModel = OllamaModelName.toHeddleModel(this.model);
    this.endpointBaseUrl = OllamaAdapter.trimTrailingSlash(endpoint.baseUrl);
    this.endpointAuth = endpoint.auth;
    this.fetcher = options.runtime?.fetchImpl ?? OllamaAdapter.defaultFetch;
    this.info = {
      provider: 'ollama',
      model: this.displayModel,
      capabilities: OllamaAdapter.capabilities,
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
      headers: OllamaAdapter.headers(this.endpointAuth),
      body: JSON.stringify({
        model: this.model,
        messages: OllamaCodec.toMessages(messages),
        tools: tools.length > 0 ? OllamaCodec.toTools(tools) : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        stream: false,
      }),
    });

    const body = await OllamaAdapter.readJsonResponse(response);
    const content = OllamaCodec.extractContent(body);
    if (content) {
      onStreamEvent?.({ type: 'content.delta', delta: content });
      onStreamEvent?.({ type: 'content.done', content });
    }

    return {
      content,
      toolCalls: OllamaCodec.extractToolCalls(body),
      usage: OllamaCodec.extractUsage(body),
    };
  }

  private static async readJsonResponse(response: globalThis.Response): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Ollama chat-completions request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
    }

    return text.trim() ? JSON.parse(text) : {};
  }

  private static trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
  }

  private static headers(auth: LlmProviderEndpointAuth): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(auth.type === 'bearer' ? { authorization: `Bearer ${auth.token}` } : {}),
    };
  }

  private static async defaultFetch(url: unknown, init?: unknown): Promise<globalThis.Response> {
    return await fetch(url as URL | RequestInfo, init as RequestInit | undefined);
  }
}
