// ---------------------------------------------------------------------------
// LLM Adapter — OpenAI implementation
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import dayjs from 'dayjs';
import type {
  Response as OpenAiResponse,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type { Fetch as OpenAiFetch } from 'openai/core.js';
import type { LlmAdapter, ChatMessage, LlmResponse, LlmAdapterCapabilities, LlmStreamEvent, ReasoningEffort, LlmAdapterCreateInput } from '@/core/llm/types.js';
import type { ToolDefinition, ToolCall } from '@/core/types.js';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import {
  OPENAI_CODEX_RESPONSES_ENDPOINT,
  OPENAI_OAUTH_ORIGINATOR,
  OpenAiOAuthService,
} from '@/core/auth/openai-oauth.js';
import {
  ProviderCredentialRepository,
  type OpenAiOAuthCredential,
  type RuntimeProviderCredential,
  type StoredProviderCredential,
} from '@/core/auth/index.js';
import { ModelPolicyService } from '@/core/llm/models/index.js';
import { OpenAiCodec } from './openai-codec.js';

export type OpenAiAdapterOptions = LlmAdapterCreateInput;

export type CompatibleFetch = (url: unknown, init?: unknown) => Promise<globalThis.Response>;
export type OpenAiAccountCredential = OpenAiOAuthCredential | RuntimeProviderCredential;

/**
 * OpenAI implementation of the LLM port. It owns OpenAI Responses streaming,
 * tool-call parsing, reasoning summary conversion, and OAuth fetch wiring.
 */
export class OpenAiAdapter implements LlmAdapter {
  private static readonly capabilities: LlmAdapterCapabilities = {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: true,
    parallelToolCalls: true,
  };

  readonly info;

  private readonly client: OpenAI;
  private readonly model: string;
  private readonly oauthCredential?: OpenAiAccountCredential;
  private readonly reasoningEffort?: ReasoningEffort;

  constructor(options: OpenAiAdapterOptions = {}) {
    const credentials = options.credentials;
    const runtime = options.runtime;
    this.oauthCredential = OpenAiOAuthFetchService.isAccountCredential(credentials?.credential) ?
        credentials.credential
      : undefined;
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.reasoningEffort = runtime?.reasoningEffort;
    this.client = new OpenAI({
      apiKey:
        this.oauthCredential ? 'heddle-oauth-placeholder'
        : OpenAiAdapter.firstDefinedNonEmpty(credentials?.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY),
      fetch: this.oauthCredential ? OpenAiOAuthFetchService.create(this.oauthCredential, {
        storePath: credentials?.credentialStorePath,
        fetchImpl: runtime?.fetchImpl,
      }) : runtime?.fetchImpl as OpenAiFetch | undefined,
    });
    this.info = {
      provider: 'openai',
      model: this.model,
      capabilities: OpenAiAdapter.capabilities,
    } satisfies LlmAdapter['info'];
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
    onStreamEvent?: (event: LlmStreamEvent) => void,
  ): Promise<LlmResponse> {
    if (this.oauthCredential) {
      ModelPolicyService.assertCredentialCompatibility({
        model: this.model,
        provider: 'openai',
        credentialMode: 'oauth',
      });
    }

    const request = OpenAiCodec.buildResponsesRequest(messages, {
      model: this.model,
      tools,
      oauthMode: Boolean(this.oauthCredential),
      reasoningEffort: this.reasoningEffort,
    });
    const stream = await this.client.responses.stream({
      ...request,
    }, { signal });

    let streamedContent = '';
    // Codex sends the assistant message classifier on
    // `response.output_item.{added,done}` as `event.item.phase`, while token
    // text arrives separately on `response.output_text.{delta,done}`. The
    // shared message/item ID is the join key. Do not classify output text as
    // commentary from its wording, event order, or content type.
    const assistantMessagePhases = new Map<string, 'commentary' | 'final_answer'>();
    const streamedToolCalls = new Map<string, { id: string; tool: string; argumentsText: string }>();
    let completedResponse: OpenAiResponse | undefined;
    try {
      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          if (assistantMessagePhases.get(event.item_id) === 'commentary') {
            onStreamEvent?.({
              type: 'commentary.delta',
              messageId: event.item_id,
              delta: event.delta,
            });
            continue;
          }

          streamedContent += event.delta;
          onStreamEvent?.({ type: 'content.delta', delta: event.delta });
          continue;
        }

        if (event.type === 'response.output_text.done') {
          if (assistantMessagePhases.get(event.item_id) === 'commentary') {
            onStreamEvent?.({
              type: 'commentary.done',
              messageId: event.item_id,
              text: event.text,
            });
            continue;
          }

          streamedContent = event.text;
          onStreamEvent?.({ type: 'content.done', content: event.text });
          continue;
        }

        if (event.type === 'response.reasoning_summary_text.delta' && event.delta) {
          onStreamEvent?.({ type: 'reasoning_summary.delta', delta: event.delta });
          continue;
        }

        if (event.type === 'response.reasoning_summary_text.done') {
          onStreamEvent?.({ type: 'reasoning_summary.done', text: event.text });
          continue;
        }

        if (event.type === 'response.reasoning_summary.delta') {
          const delta = OpenAiCodec.readReasoningSummaryDeltaText(event.delta);
          if (delta) {
            onStreamEvent?.({ type: 'reasoning_summary.delta', delta });
          }
          continue;
        }

        if (event.type === 'response.reasoning_summary.done') {
          onStreamEvent?.({ type: 'reasoning_summary.done', text: event.text });
          continue;
        }

        if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
          const item = event.item;
          const message = OpenAiCodec.readAssistantMessageMetadata(item);
          if (message?.phase) {
            assistantMessagePhases.set(message.messageId, message.phase);
          }
          if (
            item.type === 'function_call'
            && typeof item.id === 'string'
            && typeof item.call_id === 'string'
            && typeof item.name === 'string'
          ) {
            const existing = streamedToolCalls.get(item.id);
            streamedToolCalls.set(item.id, {
              id: item.call_id,
              tool: item.name,
              argumentsText:
                typeof item.arguments === 'string' && item.arguments.length > 0 ? item.arguments
                : existing?.argumentsText ?? '',
            });
          }
          continue;
        }

        if (event.type === 'response.function_call_arguments.delta') {
          const existing = streamedToolCalls.get(event.item_id);
          if (existing) {
            existing.argumentsText += event.delta;
          }
          continue;
        }

        if (event.type === 'response.function_call_arguments.done') {
          const existing = streamedToolCalls.get(event.item_id);
          if (existing) {
            existing.argumentsText = event.arguments;
          }
          continue;
        }

        if (event.type === 'response.completed') {
          completedResponse = event.response;
        }
      }
    } catch (error) {
      // Once the API has emitted a completed response, prefer that captured
      // response over failing the turn on SDK-side stream finalization/parsing.
      if (!completedResponse) {
        throw error;
      }
    }

    const response = completedResponse ?? await stream.finalResponse();
    const outputItems = Array.isArray(response.output) ? response.output : [];
    const finalResponseToolCalls = outputItems.flatMap((item): ToolCall[] => {
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
    const toolCalls = finalResponseToolCalls.length > 0 ? finalResponseToolCalls : OpenAiCodec.parseStreamedToolCalls(streamedToolCalls);
    const diagnostics = OpenAiCodec.extractAssistantDiagnostics(response, toolCalls.length > 0);
    const content = streamedContent || (diagnostics?.rationale ?? OpenAiCodec.extractAssistantContent(response, toolCalls.length > 0));

    if (!streamedContent && content) {
      onStreamEvent?.({ type: 'content.delta', delta: content });
      onStreamEvent?.({ type: 'content.done', content });
    }

    return {
      content,
      diagnostics,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: OpenAiCodec.extractUsage(response),
    };
  }

  private static firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0);
  }
}

export type OpenAiOAuthFetchOptions = {
  storePath?: string;
  fetchImpl?: CompatibleFetch;
  refreshBeforeMs?: number;
};

/**
 * Builds the OpenAI account-mode fetch implementation. Stored credentials may
 * refresh and persist; request-scoped access tokens never do either.
 */
export class OpenAiOAuthFetchService {
  static create(
    initialCredential: OpenAiAccountCredential,
    options: OpenAiOAuthFetchOptions = {},
  ): OpenAiFetch {
    let credential = initialCredential;
    const fetcher = options.fetchImpl ?? fetch;
    const refreshBeforeMs = options.refreshBeforeMs ?? 60_000;

    const oauthFetch: CompatibleFetch = async (requestInput, init) => {
      if (!dayjs(credential.expiresAt).isAfter(dayjs().add(refreshBeforeMs, 'millisecond'))) {
        if (credential.type === 'oauth-access-token') {
          throw OpenAiOAuthFetchService.expiredRuntimeCredentialError();
        }

        credential = await OpenAiOAuthService.refreshCredential(credential, { fetchImpl: fetcher as typeof fetch });
        new ProviderCredentialRepository({ storePath: options.storePath }).set(credential);
      }

      const request = requestInput instanceof Request ? requestInput : undefined;
      const requestInit = init as RequestInit | undefined;
      const headers = new Headers(requestInit?.headers ?? request?.headers);
      headers.delete('authorization');
      headers.delete('Authorization');
      headers.set('authorization', `Bearer ${credential.accessToken}`);
      headers.set('originator', OPENAI_OAUTH_ORIGINATOR);
      if (credential.accountId) {
        headers.set('ChatGPT-Account-Id', credential.accountId);
      }

      const url = OpenAiOAuthFetchService.normalizeRequestUrl(requestInput);
      const rewrittenUrl = OpenAiOAuthFetchService.shouldRouteToCodexResponses(url) ? OPENAI_CODEX_RESPONSES_ENDPOINT : url.toString();
      return await fetcher(rewrittenUrl, {
        ...requestInit,
        method: requestInit?.method ?? request?.method,
        body: requestInit?.body ?? request?.body ?? undefined,
        headers,
      });
    };
    return oauthFetch as unknown as OpenAiFetch;
  }

  static isAccountCredential(
    credential: StoredProviderCredential | RuntimeProviderCredential | undefined,
  ): credential is OpenAiAccountCredential {
    return credential?.type === 'oauth' || credential?.type === 'oauth-access-token';
  }

  private static normalizeRequestUrl(requestInput: unknown): URL {
    if (requestInput instanceof URL) {
      return requestInput;
    }
    if (requestInput instanceof Request) {
      return new URL(requestInput.url);
    }
    return new URL(String(requestInput));
  }

  private static shouldRouteToCodexResponses(url: URL): boolean {
    return url.pathname.endsWith('/responses') || url.pathname.endsWith('/chat/completions');
  }

  private static expiredRuntimeCredentialError(): Error {
    return Object.assign(
      new Error('OpenAI OAuth access token expired. Sign in again and retry.'),
      { code: 'oauth_access_token_expired', status: 401 },
    );
  }
}

/**
 * Executes and parses Codex account-mode SSE requests routed through OpenAI
 * OAuth. This is provider-specific support for external context tools.
 */
export class OpenAiCodexSseService {
  static async execute(args: {
    oauthFetch: ReturnType<typeof OpenAiOAuthFetchService.create> | undefined;
    body: unknown;
    endpoint?: string;
  }): Promise<string> {
    if (!args.oauthFetch) {
      throw new Error('Missing OAuth fetch implementation for OpenAI Codex request.');
    }

    const response = await args.oauthFetch(args.endpoint ?? OPENAI_CODEX_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.body),
    });

    if (!response.ok) {
      const failureBody = await response.text();
      const failure = new Error(failureBody || `${response.status} status code (no body)`);
      (failure as Error & { status?: number }).status = response.status;
      throw failure;
    }

    return await response.text();
  }

  static extractOutputText(text: string): string {
    const matches = [...text.matchAll(/^data: (\{.*"type":"response\.output_text\.done".*\})$/gm)];
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const raw = matches[index]?.[1];
      if (!raw) {
        continue;
      }

      try {
        const parsed = JSON.parse(raw) as { text?: unknown };
        if (typeof parsed.text === 'string' && parsed.text.trim()) {
          return parsed.text;
        }
      } catch {
        continue;
      }
    }

    return '';
  }

  static extractItems<T>(
    text: string,
    predicate: (item: unknown) => item is T,
  ): T[] {
    const items: T[] = [];
    const matches = [...text.matchAll(/^data: (\{.*"type":"response\.output_item\.done".*\})$/gm)];

    for (const match of matches) {
      const raw = match[1];
      if (!raw) {
        continue;
      }

      try {
        const parsed = JSON.parse(raw) as { item?: unknown };
        if (predicate(parsed.item)) {
          items.push(parsed.item);
        }
      } catch {
        continue;
      }
    }

    return items;
  }
}
