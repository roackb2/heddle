// ---------------------------------------------------------------------------
// LLM Adapter — OpenAI implementation
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import type {
  ResponseInputItem,
  FunctionTool,
  ResponseReasoningItem,
  Response as OpenAiResponse,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type { Fetch as OpenAiFetch } from 'openai/core.js';
import type { LlmAdapter, ChatMessage, LlmResponse, LlmAdapterCapabilities, LlmUsage, LlmStreamEvent } from './types.js';
import type { AssistantDiagnostics, ToolDefinition, ToolCall } from '../types.js';
import { DEFAULT_OPENAI_MODEL } from '../config.js';
import {
  OPENAI_CODEX_RESPONSES_ENDPOINT,
  refreshOpenAiOAuthCredential,
  type OpenAiOAuthCredential,
} from '../auth/openai-oauth.js';
import {
  setStoredProviderCredential,
  type StoredProviderCredential,
} from '../auth/provider-credentials.js';
import { isOpenAiAccountSignInModel, OPENAI_ACCOUNT_SIGN_IN_MODELS } from './openai-models.js';

export type OpenAiAdapterOptions = {
  apiKey?: string;
  model?: string;
  credential?: StoredProviderCredential;
  credentialStorePath?: string;
  fetchImpl?: CompatibleFetch;
};

type CompatibleFetch = (url: unknown, init?: unknown) => Promise<globalThis.Response>;

/**
 * Create an LLM adapter backed by the OpenAI chat completions API.
 */
export function createOpenAiAdapter(options: OpenAiAdapterOptions = {}): LlmAdapter {
  const oauthCredential = options.credential?.type === 'oauth' ? options.credential : undefined;
  const client = new OpenAI({
    apiKey:
      oauthCredential ? 'heddle-oauth-placeholder'
      : firstDefinedNonEmpty(options.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY),
    fetch: oauthCredential ? createOpenAiOAuthFetch(oauthCredential, {
      storePath: options.credentialStorePath,
      fetchImpl: options.fetchImpl,
    }) : options.fetchImpl as OpenAiFetch | undefined,
  });
  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const capabilities: LlmAdapterCapabilities = {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: true,
    parallelToolCalls: true,
  };

  return {
    info: {
      provider: 'openai',
      model,
      capabilities,
    },
    async chat(
      messages: ChatMessage[],
      tools: ToolDefinition[],
      signal?: AbortSignal,
      onStreamEvent?: (event: LlmStreamEvent) => void,
    ): Promise<LlmResponse> {
      if (oauthCredential && !isOpenAiAccountSignInModel(model)) {
        throw new Error(`OpenAI account sign-in is not enabled for model ${model}. Use one of ${formatOpenAiAccountSignInModels()}, or set OPENAI_API_KEY to use Platform API-key mode.`);
      }

      const request = buildOpenAiResponsesRequest(messages, {
        model,
        tools,
        oauthMode: Boolean(oauthCredential),
      });
      const stream = await client.responses.stream({
        ...request,
      }, { signal });

      let streamedContent = '';
      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          streamedContent += event.delta;
          onStreamEvent?.({ type: 'content.delta', delta: event.delta });
          continue;
        }

        if (event.type === 'response.output_text.done') {
          streamedContent = event.text;
          onStreamEvent?.({ type: 'content.done', content: event.text });
        }
      }

      const response = await stream.finalResponse();
      const toolCalls = response.output.flatMap((item): ToolCall[] => {
        if (
          item.type !== 'function_call'
          || typeof (item as { call_id?: unknown }).call_id !== 'string'
          || typeof (item as { name?: unknown }).name !== 'string'
          || typeof (item as { arguments?: unknown }).arguments !== 'string'
        ) {
          return [];
        }

        return [{
          id: item.call_id,
          tool: item.name,
          input: JSON.parse(item.arguments),
        }];
      });
      const diagnostics = extractAssistantDiagnostics(response, toolCalls.length > 0);
      const content = streamedContent || (diagnostics?.rationale ?? extractAssistantContent(response, toolCalls.length > 0));

      if (!streamedContent && content) {
        onStreamEvent?.({ type: 'content.delta', delta: content });
        onStreamEvent?.({ type: 'content.done', content });
      }

      return {
        content,
        diagnostics,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: extractUsage(response),
      };
    },
  };
}

function formatOpenAiAccountSignInModels(): string {
  return OPENAI_ACCOUNT_SIGN_IN_MODELS.join(', ');
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}

export function createOpenAiOAuthFetch(
  initialCredential: OpenAiOAuthCredential,
  options: {
    storePath?: string;
    fetchImpl?: CompatibleFetch;
    refreshBeforeMs?: number;
  } = {},
): OpenAiFetch {
  let credential = initialCredential;
  const fetcher = options.fetchImpl ?? fetch;
  const refreshBeforeMs = options.refreshBeforeMs ?? 60_000;

  const oauthFetch: CompatibleFetch = async (requestInput, init) => {
    if (credential.expiresAt <= Date.now() + refreshBeforeMs) {
      credential = await refreshOpenAiOAuthCredential(credential, { fetchImpl: fetcher as typeof fetch });
      setStoredProviderCredential(credential, options.storePath);
    }

    const request = requestInput instanceof Request ? requestInput : undefined;
    const requestInit = init as RequestInit | undefined;
    const headers = new Headers(requestInit?.headers ?? request?.headers);
    headers.delete('authorization');
    headers.delete('Authorization');
    headers.set('authorization', `Bearer ${credential.accessToken}`);
    if (credential.accountId) {
      headers.set('ChatGPT-Account-Id', credential.accountId);
    }

    const url = normalizeRequestUrl(requestInput);
    const rewrittenUrl = shouldRouteToCodexResponses(url) ? OPENAI_CODEX_RESPONSES_ENDPOINT : url.toString();
    return await fetcher(rewrittenUrl, {
      ...requestInit,
      method: requestInit?.method ?? request?.method,
      body: requestInit?.body ?? request?.body ?? undefined,
      headers,
    });
  };
  return oauthFetch as unknown as OpenAiFetch;
}

function normalizeRequestUrl(requestInput: unknown): URL {
  if (requestInput instanceof URL) {
    return requestInput;
  }
  if (requestInput instanceof Request) {
    return new URL(requestInput.url);
  }
  return new URL(String(requestInput));
}

function shouldRouteToCodexResponses(url: URL): boolean {
  return url.pathname.endsWith('/responses') || url.pathname.endsWith('/chat/completions');
}

// ---------------------------------------------------------------------------
// Internal converters
// ---------------------------------------------------------------------------

function extractAssistantContent(response: OpenAiResponse, hasToolCalls: boolean): string | undefined {
  if (response.output_text) {
    return response.output_text;
  }

  if (!hasToolCalls) {
    return undefined;
  }

  const reasoningSummary = response.output
    .filter((item): item is ResponseReasoningItem => item.type === 'reasoning')
    .flatMap((item) => item.summary)
    .map((summary) => summary.text.trim())
    .filter(Boolean)
    .join(' ');

  return reasoningSummary || undefined;
}

function extractAssistantDiagnostics(response: OpenAiResponse, hasToolCalls: boolean): AssistantDiagnostics | undefined {
  if (!hasToolCalls) {
    return undefined;
  }

  const rationale = response.output
    .filter((item): item is ResponseReasoningItem => item.type === 'reasoning')
    .flatMap((item) => item.summary)
    .map((summary) => summary.text.trim())
    .filter(Boolean)
    .join(' ');

  if (!rationale) {
    return undefined;
  }

  return { rationale };
}

function extractUsage(response: OpenAiResponse): LlmUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.total_tokens,
    cachedInputTokens: response.usage.input_tokens_details.cached_tokens || undefined,
    reasoningTokens: response.usage.output_tokens_details.reasoning_tokens || undefined,
    requests: 1,
  };
}

function toResponseInput(messages: ChatMessage[]): ResponseInputItem[] {
  return messages.flatMap((message) => toResponseInputItems(message));
}

function buildOpenAiResponsesRequest(
  messages: ChatMessage[],
  options: {
    model: string;
    tools: ToolDefinition[];
    oauthMode: boolean;
  },
): {
  model: string;
  input: ResponseInputItem[];
  tools?: FunctionTool[];
  store: boolean;
  reasoning: { summary: 'auto' | 'detailed' };
  instructions?: string;
} {
  const systemMessages = options.oauthMode ? messages.filter((message): message is Extract<ChatMessage, { role: 'system' }> => message.role === 'system') : [];
  const inputMessages = options.oauthMode ? messages.filter((message) => message.role !== 'system') : messages;
  const instructions =
    options.oauthMode ?
      systemMessages.map((message) => message.content.trim()).filter(Boolean).join('\n\n')
    : undefined;

  return {
    model: options.model,
    input: toResponseInput(inputMessages),
    tools: options.tools.length > 0 ? options.tools.map(toResponseTool) : undefined,
    store: false,
    reasoning: {
      summary: options.oauthMode ? 'auto' : 'detailed',
    },
    ...(instructions ? { instructions } : {}),
  };
}

function toResponseInputItems(msg: ChatMessage): ResponseInputItem[] {
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

function toResponseTool(tool: ToolDefinition): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}
