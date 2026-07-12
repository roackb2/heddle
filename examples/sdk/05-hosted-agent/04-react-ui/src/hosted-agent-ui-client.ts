/**
 * Product client boundary above Heddle's run transport.
 *
 * The reusable run operations come from Heddle. Session read/reset are this
 * example host's product API, so they remain explicit application code.
 */
import type { ZodType } from 'zod';
import { ConversationRunHttpSseClient } from '../../../../../src/core/chat/remote/http-sse/index.js';
import {
  HostedAgentClientContract,
  type HostedAgentClient,
} from '../../03-browser-client/browser-client.js';
import {
  HostedAgentApiErrorSchema,
  HostedAgentConversationSchema,
  type HostedAgentConversation,
} from '../../02-http-sse-api/contracts.js';

export type HostedAgentUiClientOptions = {
  baseUrl: string;
  getHeaders: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof globalThis.fetch;
};

export class HostedAgentUiClientError extends Error {
  readonly name = 'HostedAgentUiClientError';

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class HostedAgentUiClient {
  readonly runs: HostedAgentClient;
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: HostedAgentUiClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) {
      throw new HostedAgentUiClientError('Hosted agent baseUrl cannot be empty.');
    }
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.runs = new ConversationRunHttpSseClient({
      baseUrl: this.baseUrl,
      ...HostedAgentClientContract,
      getHeaders: options.getHeaders,
      fetch: this.fetch,
    });
  }

  async readConversation(sessionId: string, signal?: AbortSignal): Promise<HostedAgentConversation> {
    return await this.request(
      `/sessions/${encodeURIComponent(requireSessionId(sessionId))}`,
      HostedAgentConversationSchema,
      { signal },
    );
  }

  async resetConversation(sessionId: string, signal?: AbortSignal): Promise<HostedAgentConversation> {
    return await this.request(
      `/sessions/${encodeURIComponent(requireSessionId(sessionId))}/reset`,
      HostedAgentConversationSchema,
      { method: 'POST', signal },
    );
  }

  private async request<Result>(
    path: string,
    schema: ZodType<Result>,
    init: RequestInit,
  ): Promise<Result> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: new Headers(await this.options.getHeaders()),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new HostedAgentUiClientError(
        'Hosted agent session response contained invalid JSON.',
        response.status,
        undefined,
        { cause: error },
      );
    }
    if (!response.ok) {
      const apiError = HostedAgentApiErrorSchema.safeParse(body);
      throw apiError.success
        ? new HostedAgentUiClientError(
          apiError.data.error.message,
          response.status,
          apiError.data.error.code,
        )
        : new HostedAgentUiClientError(
          `Hosted agent session request failed (${response.status}).`,
          response.status,
        );
    }
    return schema.parse(body);
  }
}

function requireSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new HostedAgentUiClientError('Hosted agent session ID cannot be empty.');
  }
  return normalized;
}
