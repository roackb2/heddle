import {
  createParser,
  type EventSourceMessage,
} from 'eventsource-parser';
import type { ZodType } from 'zod';
import {
  CancelHostedAgentRunResultSchema,
  HostedAgentApiErrorSchema,
  HostedAgentRunEventSchema,
  StartHostedAgentRunResultSchema,
  type CancelHostedAgentRunResult,
  type HostedAgentRunEvent,
  type StartHostedAgentRunInput,
  type StartHostedAgentRunResult,
} from './contracts.js';

type Fetch = typeof globalThis.fetch;

export type HostedAgentClientOptions = {
  baseUrl: string;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: Fetch;
};

export class HostedAgentClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Owns the browser-side HTTP/SSE protocol, not reconnect or UI policy. */
export class HostedAgentClient {
  private readonly baseUrl: string;
  private readonly fetch: Fetch;

  constructor(private readonly options: HostedAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async start(input: StartHostedAgentRunInput, signal?: AbortSignal): Promise<StartHostedAgentRunResult> {
    return await this.request('/runs', StartHostedAgentRunResultSchema, {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
  }

  async subscribe(input: {
    runId: string;
    afterSequence?: number;
    signal?: AbortSignal;
    onEvent(event: HostedAgentRunEvent): void | Promise<void>;
  }): Promise<void> {
    if (input.afterSequence !== undefined
      && (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0)) {
      throw new HostedAgentClientError('afterSequence must be a non-negative safe integer.');
    }

    const query = input.afterSequence === undefined ? '' : `?after=${input.afterSequence}`;
    const response = await this.fetch(
      `${this.baseUrl}/runs/${encodeURIComponent(input.runId)}/events${query}`,
      {
        headers: await this.headers({ Accept: 'text/event-stream' }),
        signal: input.signal,
      },
    );
    if (!response.ok || !response.body) {
      throw await this.responseError(response);
    }
    if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
      throw new HostedAgentClientError('Hosted agent event response was not an SSE stream.', response.status);
    }

    const pending: EventSourceMessage[] = [];
    const parser = createParser({
      onEvent: (event) => pending.push(event),
      onError: (error) => {
        throw error;
      },
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const flushPending = async () => {
      while (pending.length > 0) {
        input.signal?.throwIfAborted();
        const message = pending.shift();
        if (message) {
          await input.onEvent(parseEvent(message));
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
          return;
        }
        parser.feed(decoder.decode(value, { stream: true }));
        await flushPending();
      }
    } finally {
      reader.releaseLock();
    }
  }

  async cancel(runId: string, signal?: AbortSignal): Promise<CancelHostedAgentRunResult> {
    return await this.request(
      `/runs/${encodeURIComponent(runId)}/cancel`,
      CancelHostedAgentRunResultSchema,
      { method: 'POST', signal },
    );
  }

  private async request<Result>(path: string, schema: ZodType<Result>, init: RequestInit): Promise<Result> {
    const headers = await this.headers(init.headers ?? {});
    headers.set('Content-Type', 'application/json');
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw await this.responseError(response);
    }
    return schema.parse(await response.json());
  }

  private async headers(additions: HeadersInit): Promise<Headers> {
    const headers = new Headers(await this.options.getHeaders?.());
    new Headers(additions).forEach((value, name) => headers.set(name, value));
    return headers;
  }

  private async responseError(response: Response): Promise<HostedAgentClientError> {
    const body = await response.json().catch(() => undefined);
    const parsed = HostedAgentApiErrorSchema.safeParse(body);
    return parsed.success
      ? new HostedAgentClientError(parsed.data.error.message, response.status, parsed.data.error.code)
      : new HostedAgentClientError(`Hosted agent request failed (${response.status}).`, response.status);
  }
}

function parseEvent(message: EventSourceMessage): HostedAgentRunEvent {
  let body: unknown;
  try {
    body = JSON.parse(message.data);
  } catch {
    throw new HostedAgentClientError('Hosted agent event contained invalid JSON.');
  }

  const event = HostedAgentRunEventSchema.parse(body);
  if (message.id !== String(event.sequence)) {
    throw new HostedAgentClientError('Hosted agent event ID did not match its canonical sequence.');
  }
  if (message.event !== event.kind) {
    throw new HostedAgentClientError('Hosted agent SSE event name did not match its payload kind.');
  }
  return event;
}
