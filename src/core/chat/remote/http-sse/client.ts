import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  createParser,
  type EventSourceMessage,
} from 'eventsource-parser';
import { z } from 'zod';
import {
  ConversationRunReplayCursorSchema,
} from '../protocol-codec.js';
import type {
  ConversationRunProtocolEvent,
  ConversationRunReference,
} from '../types.js';
import type {
  ConversationRunHttpErrorPayload,
  ConversationRunHttpSseClientOptions,
  SubscribeConversationRunHttpSseInput,
} from './types.js';

const ConversationRunHttpErrorPayloadSchema = z.object({
  error: z.object({
    code: z.string().trim().min(1),
    message: z.string(),
  }),
});

/** A REST/SSE request failed or returned a malformed transport envelope. */
export class ConversationRunHttpSseClientError extends Error {
  readonly name = 'ConversationRunHttpSseClientError';

  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Browser-safe client for Heddle's conventional REST/SSE run resource.
 *
 * This preset assumes POST `/runs`, GET `/runs/:runId/events`, and POST
 * `/runs/:runId/cancel`. Authentication headers and public payload schemas
 * remain host-owned.
 */
export class ConversationRunHttpSseClient<
  StartInput,
  Accepted extends ConversationRunReference,
  Activity,
  Result,
  Cancellation,
> {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: ConversationRunHttpSseClientOptions<
    Accepted,
    Activity,
    Result,
    Cancellation
  >) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) {
      throw new ConversationRunHttpSseClientError('Conversation run baseUrl cannot be empty.');
    }
    if (!options.fetch && typeof globalThis.fetch !== 'function') {
      throw new ConversationRunHttpSseClientError('Conversation run HTTP client requires fetch.');
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async start(input: StartInput, signal?: AbortSignal): Promise<Accepted> {
    return await this.request('/runs', this.options.accepted, {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
  }

  async subscribe(input: SubscribeConversationRunHttpSseInput<Activity, Result>): Promise<void> {
    const runId = input.runId.trim();
    if (!runId) {
      throw new ConversationRunHttpSseClientError('Conversation run ID cannot be empty.');
    }
    if (input.afterSequence !== undefined) {
      const cursor = ConversationRunReplayCursorSchema.safeParse(input.afterSequence);
      if (!cursor.success) {
        throw new ConversationRunHttpSseClientError('afterSequence must be a non-negative safe integer.');
      }
    }

    const query = input.afterSequence === undefined ? '' : `?after=${input.afterSequence}`;
    const response = await this.fetch(
      `${this.baseUrl}/runs/${encodeURIComponent(runId)}/events${query}`,
      {
        headers: await this.headers({ Accept: 'text/event-stream' }),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw await this.responseError(response);
    }
    if (!response.body) {
      throw new ConversationRunHttpSseClientError(
        'Conversation run event response did not include a readable body.',
        response.status,
      );
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'text/event-stream') {
      throw new ConversationRunHttpSseClientError(
        'Conversation run event response was not an SSE stream.',
        response.status,
      );
    }

    await this.consumeEventStream(response.body, runId, input);
  }

  async cancel(runId: string, signal?: AbortSignal): Promise<Cancellation> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      throw new ConversationRunHttpSseClientError('Conversation run ID cannot be empty.');
    }
    return await this.request(
      `/runs/${encodeURIComponent(normalizedRunId)}/cancel`,
      this.options.cancellation,
      { method: 'POST', signal },
    );
  }

  private async consumeEventStream(
    body: ReadableStream<Uint8Array>,
    runId: string,
    input: SubscribeConversationRunHttpSseInput<Activity, Result>,
  ): Promise<void> {
    const pending: EventSourceMessage[] = [];
    const parser = createParser({
      onEvent: (event) => pending.push(event),
      onError: (error) => {
        throw new ConversationRunHttpSseClientError('Conversation run SSE framing was invalid.', undefined, undefined, {
          cause: error,
        });
      },
    });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let completed = false;
    const flushPending = async () => {
      while (pending.length > 0) {
        input.signal?.throwIfAborted();
        const message = pending.shift();
        if (message) {
          await input.onEvent(this.parseEvent(message, runId));
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          parser.feed(decoder.decode());
          parser.reset({ consume: true });
          await flushPending();
          completed = true;
          return;
        }
        parser.feed(decoder.decode(value, { stream: true }));
        await flushPending();
      }
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }
  }

  private parseEvent(
    message: EventSourceMessage,
    expectedRunId: string,
  ): ConversationRunProtocolEvent<Activity, Result> {
    let body: unknown;
    try {
      body = JSON.parse(message.data);
    } catch (error) {
      throw new ConversationRunHttpSseClientError('Conversation run event contained invalid JSON.', undefined, undefined, {
        cause: error,
      });
    }

    const event = this.options.protocol.parseEvent(body);
    if (event.runId !== expectedRunId) {
      throw new ConversationRunHttpSseClientError('Conversation run event belonged to a different run.');
    }
    if (message.id !== String(event.sequence)) {
      throw new ConversationRunHttpSseClientError('Conversation run event ID did not match its canonical sequence.');
    }
    if (message.event !== event.kind) {
      throw new ConversationRunHttpSseClientError('Conversation run SSE event name did not match its payload kind.');
    }
    return event;
  }

  private async request<Output>(
    path: string,
    schema: StandardSchemaV1<unknown, Output>,
    init: RequestInit,
  ): Promise<Output> {
    const headers = await this.headers(init.headers ?? {});
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw await this.responseError(response);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new ConversationRunHttpSseClientError(
        'Conversation run response contained invalid JSON.',
        response.status,
        undefined,
        { cause: error },
      );
    }
    return await parseResponse(schema, body, response.status);
  }

  private async headers(additions: HeadersInit): Promise<Headers> {
    const headers = new Headers(await this.options.getHeaders?.());
    new Headers(additions).forEach((value, name) => headers.set(name, value));
    return headers;
  }

  private async responseError(response: Response): Promise<ConversationRunHttpSseClientError> {
    const body = await response.json().catch(() => undefined);
    const parsed = ConversationRunHttpErrorPayloadSchema.safeParse(body);
    return parsed.success
      ? errorFromPayload(response.status, parsed.data)
      : new ConversationRunHttpSseClientError(
        `Conversation run request failed (${response.status}).`,
        response.status,
      );
  }
}

async function parseResponse<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  input: unknown,
  status: number,
): Promise<Output> {
  const result = await schema['~standard'].validate(input);
  if (result.issues) {
    throw new ConversationRunHttpSseClientError(
      `Conversation run response validation failed: ${result.issues.map(({ message }) => message).join('; ')}`,
      status,
    );
  }
  return result.value;
}

function errorFromPayload(
  status: number,
  payload: ConversationRunHttpErrorPayload,
): ConversationRunHttpSseClientError {
  return new ConversationRunHttpSseClientError(
    payload.error.message,
    status,
    payload.error.code,
  );
}
