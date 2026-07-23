import type {
  ChatMessage,
  LlmAdapter,
  LlmAdapterCreateInput,
  LlmProviderEndpointAuth,
  LlmResponse,
  LlmStreamEvent,
} from '@/core/llm/types.js';
import type { ToolDefinition } from '@/core/types.js';
import { OpenAiCompatibleCodec } from './openai-compatible-codec.js';
import { OpenAiCompatibleModelName } from './openai-compatible-model.js';
import type { OpenAiCompatibleProviderProfile } from './types.js';

export type OpenAiCompatibleAdapterOptions = LlmAdapterCreateInput & {
  provider: OpenAiCompatibleProviderProfile['id'];
  model: string;
  profile: OpenAiCompatibleProviderProfile;
};

/**
 * Shared adapter for OpenAI-compatible `/chat/completions` providers such as
 * Ollama, LM Studio, LiteLLM, vLLM, Hugging Face router, OpenRouter, Together,
 * and Groq. Profiles own endpoint/model identity; this class owns the common
 * HTTP transport and response parsing.
 */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly info;

  private readonly profile: OpenAiCompatibleProviderProfile;
  private readonly model: string;
  private readonly displayModel: string;
  private readonly endpointBaseUrl: string;
  private readonly endpointAuth: LlmProviderEndpointAuth;
  private readonly fetcher: (url: unknown, init?: unknown) => Promise<globalThis.Response>;

  constructor(options: OpenAiCompatibleAdapterOptions) {
    const endpoint = options.runtime?.endpoint;
    if (!endpoint) {
      throw new Error(`Missing ${options.profile.label} endpoint runtime. Resolve provider runtime before creating the adapter.`);
    }

    this.profile = options.profile;
    this.model = OpenAiCompatibleModelName.toProviderModel(options.profile, options.model);
    this.displayModel = OpenAiCompatibleModelName.toHeddleModel(options.profile, this.model);
    this.endpointBaseUrl = OpenAiCompatibleAdapter.trimTrailingSlash(endpoint.baseUrl);
    this.endpointAuth = endpoint.auth;
    this.fetcher = options.runtime?.fetchImpl ?? OpenAiCompatibleAdapter.defaultFetch;
    this.info = {
      provider: options.profile.id,
      model: this.displayModel,
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
      headers: OpenAiCompatibleAdapter.headers(this.endpointAuth),
      body: JSON.stringify({
        model: this.model,
        messages: OpenAiCompatibleCodec.toMessages(messages),
        tools: tools.length > 0 ? OpenAiCompatibleCodec.toTools(tools) : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        stream: false,
      }),
    });

    const body = await this.readJsonResponse(response);
    const content = OpenAiCompatibleCodec.extractContent(body);
    if (content) {
      onStreamEvent?.({ type: 'content.delta', delta: content });
      onStreamEvent?.({ type: 'content.done', content });
    }

    return {
      content,
      toolCalls: OpenAiCompatibleCodec.extractToolCalls(body),
      usage: OpenAiCompatibleCodec.extractUsage(body, {
        provider: this.profile.id,
        model: this.displayModel,
      }),
    };
  }

  private async readJsonResponse(response: globalThis.Response): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${this.profile.label} chat-completions request failed: ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
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
