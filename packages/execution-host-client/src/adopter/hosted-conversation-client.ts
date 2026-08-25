import { z } from 'zod';
import {
  ExecutionHostStreamEventSchema,
  isExecutionHostTerminalEvent,
  isSafeWebUrl,
  type ExecutionHostStreamEvent,
} from '../contracts/index.js';
import {
  readExecutionHostEventStream,
  toExecutionHostTransportError,
} from '../internal/execution-host-event-stream.js';
import { readBoundedJsonResponse } from '../internal/http-response.js';
import {
  DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
  HostedConversationPublicErrorSchema,
  HostedConversationRequestSchema,
} from './contracts.js';
import type {
  HostedConversationClientConfig,
  HostedConversationClientTurnInput,
  HostedConversationStreamClient,
} from './types.js';

const MAX_ERROR_BODY_BYTES = 16_384;
const AccessTokenSchema = z.string().trim().min(1).max(4_096).regex(
  /^\S+$/,
  'accessToken must not contain whitespace',
);

export class HostedConversationClientError extends Error {
  readonly name = 'HostedConversationClientError';

  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Browser-safe client for an adopter's authenticated hosted-conversation edge.
 *
 * Product code supplies its user token. Heddle owns the request shape,
 * redirect refusal, bounded public errors, ordered SSE validation, truthful
 * terminal settlement, cancellation, and ambiguous-interruption semantics.
 */
export class HostedConversationClient
implements HostedConversationStreamClient {
  readonly #endpoint: string | URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(config: HostedConversationClientConfig = {}) {
    this.#endpoint = parseEndpoint(
      config.endpoint ?? DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
    );
    this.#fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async *streamTurn(
    rawInput: HostedConversationClientTurnInput,
  ): AsyncIterable<ExecutionHostStreamEvent> {
    const request = HostedConversationRequestSchema.parse({
      prompt: rawInput.prompt,
    });
    const accessToken = AccessTokenSchema.parse(rawInput.accessToken);
    if (rawInput.signal?.aborted) {
      throw toExecutionHostTransportError(
        rawInput.signal.reason,
        rawInput.signal,
      );
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: rawInput.signal,
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      if (rawInput.signal?.aborted) {
        throw toExecutionHostTransportError(error, rawInput.signal);
      }
      throw new HostedConversationClientError(
        'Hosted conversation endpoint could not be reached.',
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new HostedConversationClientError(
        await readPublicError(response),
        response.status,
      );
    }
    yield* readExecutionHostEventStream({
      response,
      schema: ExecutionHostStreamEventSchema,
      isTerminal: isExecutionHostTerminalEvent,
      signal: rawInput.signal,
    });
  }
}

async function readPublicError(response: Response): Promise<string> {
  const parsed = HostedConversationPublicErrorSchema.safeParse(
    await readBoundedJsonResponse(response, MAX_ERROR_BODY_BYTES),
  );
  return parsed.success
    ? parsed.data.error.message
    : fallbackError(response.status);
}

function fallbackError(status: number): string {
  return status === 401
    ? 'Hosted conversation authorization was not accepted.'
    : 'Hosted conversation could not be started.';
}

function parseEndpoint(value: string | URL): string | URL {
  if (value instanceof URL) {
    return parseAbsoluteEndpoint(new URL(value));
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new HostedConversationClientError(
      'Hosted conversation endpoint cannot be empty.',
    );
  }
  if (normalized.startsWith('/')) {
    const relative = new URL(normalized, 'https://adopter.invalid');
    if (relative.search || relative.hash || relative.pathname !== normalized) {
      throw new HostedConversationClientError(
        'Hosted conversation endpoint must be a path without query or fragment.',
      );
    }
    return relative.pathname;
  }
  return parseAbsoluteEndpoint(new URL(normalized));
}

function parseAbsoluteEndpoint(url: URL): URL {
  if (!isSafeWebUrl(url)) {
    throw new HostedConversationClientError(
      'Hosted conversation endpoint must use HTTPS or loopback HTTP without credentials, query, or fragment.',
    );
  }
  return url;
}
