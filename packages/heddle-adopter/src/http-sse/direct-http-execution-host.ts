import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { z } from 'zod';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  CONVERSATION_TURN_WORKFLOW,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  ExecutionHostConversationTurnRequestSchema,
  ExecutionHostStreamEventSchema,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
  OpaqueIdSchema,
  RuntimeSessionIdSchema,
  TimestampSchema,
  isSafeWebUrl,
  type ExecutionHostStreamEvent,
} from '../contracts/index.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
} from './errors.js';
import type {
  DirectHttpExecutionHostConfig,
  ExecutionHost,
  ExecutionHostConversationTurn,
} from './types.js';

const MAX_SSE_BUFFER_CHARACTERS = 1_048_576;
const MAX_PENDING_SSE_FRAMES = 1_024;
const MAX_ERROR_BODY_BYTES = 16_384;
const SecretSchema = z.string().min(8).max(4_096);
const ConversationTurnSchema = z.object({
  invocationId: OpaqueIdSchema,
  runtimeSessionId: RuntimeSessionIdSchema,
  prompt: z.string().trim().min(1).max(200_000),
  deadlineAt: TimestampSchema.optional(),
  executionAssertion: z.string().min(32).max(4_096),
  mcpCapability: z.string().min(32).max(4_096).optional(),
  modelApiKey: SecretSchema,
  signal: z.custom<AbortSignal>(
    (value) => value instanceof AbortSignal,
    'signal must be an AbortSignal',
  ).optional(),
}).strict();
const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(128).regex(/^[a-z0-9_]+$/),
    message: z.string(),
  }).strict(),
}).strict();

/**
 * Strict direct-development HTTP/SSE adapter for the Execution Host v1 wire.
 * It deliberately owns neither AWS SDK nor SigV4 behavior.
 */
export class DirectHttpExecutionHost implements ExecutionHost {
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #localToken: string;

  constructor(config: DirectHttpExecutionHostConfig) {
    assertSafeBaseUrl(config.baseUrl);
    this.#localToken = SecretSchema.parse(config.localToken);
    this.#endpoint = new URL('invocations', withTrailingSlash(config.baseUrl));
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async *streamConversationTurn(
    rawInput: ExecutionHostConversationTurn,
  ): AsyncIterable<ExecutionHostStreamEvent> {
    const input = ConversationTurnSchema.parse(rawInput);
    if (input.signal?.aborted) {
      throw new ExecutionHostInvocationCancelledError();
    }

    const response = await this.#invoke(input);
    if (!response.ok) {
      throw new ExecutionHostRejectedError(
        response.status,
        await readSafeErrorCode(response),
      );
    }
    if (!isEventStream(response.headers.get('content-type'))) {
      await cancelBody(response);
      throw new ExecutionHostProtocolError(
        'Execution Host did not return an SSE stream.',
      );
    }
    if (!response.body) {
      throw new ExecutionHostProtocolError(
        'Execution Host returned an empty SSE response body.',
      );
    }

    const state: StreamValidationState = {
      invocationId: input.invocationId,
      nextSequence: 0,
      terminal: false,
    };
    const decoder = new TextDecoder();
    const pending: EventSourceMessage[] = [];
    let terminalEvent: ExecutionHostStreamEvent | undefined;
    let parserError = false;
    const parser = createParser({
      maxBufferSize: MAX_SSE_BUFFER_CHARACTERS,
      onEvent: (event) => {
        if (pending.length >= MAX_PENDING_SSE_FRAMES) {
          parserError = true;
          return;
        }
        pending.push(event);
      },
      onError: () => {
        parserError = true;
      },
    });

    try {
      for await (const chunk of response.body) {
        input.signal?.throwIfAborted();
        parser.feed(decoder.decode(chunk, { stream: true }));
        if (parserError) {
          throw new ExecutionHostProtocolError();
        }
        while (pending.length > 0) {
          const event = validateEvent(pending.shift()!, state);
          if (isTerminalEvent(event)) {
            terminalEvent = event;
          } else {
            yield event;
          }
        }
      }
      parser.feed(decoder.decode());
      parser.reset({ consume: true });
      if (parserError) {
        throw new ExecutionHostProtocolError();
      }
      while (pending.length > 0) {
        const event = validateEvent(pending.shift()!, state);
        if (isTerminalEvent(event)) {
          terminalEvent = event;
        } else {
          yield event;
        }
      }
    } catch (error) {
      if (error instanceof ExecutionHostProtocolError) {
        throw error;
      }
      throw toTransportError(error, input.signal);
    }

    if (!state.accepted) {
      throw new ExecutionHostProtocolError(
        'Execution Host stream omitted the accepted event.',
      );
    }
    if (!state.terminal || !terminalEvent) {
      throw new ExecutionHostStreamInterruptedError();
    }
    // Terminal is released only after clean EOF, so a trailing malformed or
    // post-terminal frame cannot be projected as success.
    yield terminalEvent;
  }

  async #invoke(
    input: z.infer<typeof ConversationTurnSchema>,
  ): Promise<Response> {
    const body = ExecutionHostConversationTurnRequestSchema.parse({
      schemaVersion: EXECUTION_CONTRACT_VERSION,
      kind: CONVERSATION_TURN_WORKFLOW,
      invocationId: input.invocationId,
      prompt: input.prompt,
      ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
    });
    try {
      return await this.#fetch(this.#endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: input.signal,
        headers: createSensitiveHeaders(input, this.#localToken),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw toTransportError(error, input.signal);
    }
  }
}

type StreamValidationState = {
  invocationId: string;
  runId?: string;
  nextSequence: number;
  accepted?: true;
  terminal: boolean;
};

function validateEvent(
  frame: EventSourceMessage,
  state: StreamValidationState,
): ExecutionHostStreamEvent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(frame.data);
  } catch {
    throw new ExecutionHostProtocolError();
  }
  const parsed = ExecutionHostStreamEventSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ExecutionHostProtocolError();
  }
  const event = parsed.data;
  const correctFrameMetadata = frame.event === event.kind
    && frame.id === String(event.sequence);
  const correctEnvelope = event.invocationId === state.invocationId
    && event.sequence === state.nextSequence;
  if (!correctFrameMetadata || !correctEnvelope || state.terminal) {
    throw new ExecutionHostProtocolError();
  }

  if (!state.accepted) {
    if (event.kind !== 'accepted') {
      throw new ExecutionHostProtocolError();
    }
    state.accepted = true;
    state.runId = event.runId;
  } else if (event.kind === 'accepted' || event.runId !== state.runId) {
    throw new ExecutionHostProtocolError();
  }

  state.nextSequence += 1;
  state.terminal = isTerminalEvent(event);
  return event;
}

function createSensitiveHeaders(
  input: z.infer<typeof ConversationTurnSchema>,
  localToken: string,
): Headers {
  const headers = new Headers({
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    [AGENTCORE_RUNTIME_SESSION_HEADER]: input.runtimeSessionId,
    [EXECUTION_HOST_LOCAL_TOKEN_HEADER]: localToken,
    [MODEL_API_KEY_HEADER]: input.modelApiKey,
    [EXECUTION_ASSERTION_HEADER]: input.executionAssertion,
  });
  if (input.mcpCapability) {
    headers.set(MCP_CAPABILITY_HEADER, input.mcpCapability);
  }
  return headers;
}

function isEventStream(contentType: string | null): boolean {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase()
    === 'text/event-stream';
}

function isTerminalEvent(event: ExecutionHostStreamEvent): boolean {
  return event.kind === 'result'
    || event.kind === 'cancelled'
    || event.kind === 'error';
}

async function readSafeErrorCode(response: Response): Promise<string> {
  try {
    const declaredLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength)
      && declaredLength > MAX_ERROR_BODY_BYTES
    ) {
      await cancelBody(response);
      return 'unknown';
    }
    const bytes = await readBoundedBody(response, MAX_ERROR_BODY_BYTES);
    if (!bytes) {
      return 'unknown';
    }
    const parsed = ApiErrorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return parsed.success ? parsed.data.error.code : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup is best effort and must not replace the protocol error.
  }
}

function toTransportError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted || isAbortError(error)) {
    return new ExecutionHostInvocationCancelledError();
  }
  return new ExecutionHostStreamInterruptedError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function assertSafeBaseUrl(url: URL): void {
  if (!isSafeWebUrl(url)) {
    throw new Error(
      'Direct Execution Host URL must use HTTPS or loopback HTTP and contain no credentials, query, or fragment.',
    );
  }
}

function withTrailingSlash(url: URL): URL {
  const normalized = new URL(url);
  normalized.pathname = normalized.pathname.endsWith('/')
    ? normalized.pathname
    : `${normalized.pathname}/`;
  return normalized;
}
