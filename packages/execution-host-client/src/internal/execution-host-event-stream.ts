import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { z } from 'zod';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostStreamInterruptedError,
} from '../http-sse/errors.js';
import {
  cancelResponseBody,
  isEventStreamResponse,
} from './http-response.js';

const MAX_SSE_BUFFER_CHARACTERS = 1_048_576;
const MAX_PENDING_SSE_FRAMES = 1_024;

type ExecutionHostEvent = {
  kind: string;
  invocationId: string;
  runId: string;
  sequence: number;
  timestamp: string;
};

type StreamValidationState = {
  invocationId?: string;
  runId?: string;
  nextSequence: number;
  accepted?: true;
  terminal: boolean;
};

export async function* readExecutionHostEventStream<
  Event extends ExecutionHostEvent,
>(input: {
  response: Response;
  schema: z.ZodType<Event>;
  isTerminal: (event: Event) => boolean;
  invocationId?: string;
  signal?: AbortSignal;
}): AsyncIterable<Event> {
  if (!isEventStreamResponse(input.response)) {
    await cancelResponseBody(input.response);
    throw new ExecutionHostProtocolError(
      'Execution Host did not return an SSE stream.',
    );
  }
  if (!input.response.body) {
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
  let terminalEvent: Event | undefined;
  let parserFailed = false;
  const parser = createParser({
    maxBufferSize: MAX_SSE_BUFFER_CHARACTERS,
    onEvent: (event) => {
      if (pending.length >= MAX_PENDING_SSE_FRAMES) {
        parserFailed = true;
        return;
      }
      pending.push(event);
    },
    onError: () => {
      parserFailed = true;
    },
  });
  const reader = input.response.body.getReader();

  try {
    while (true) {
      input.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parser.feed(decoder.decode(value, { stream: true }));
      assertParserHealthy(parserFailed);
      for (const event of drainEvents(pending, state, input.schema, input.isTerminal)) {
        if (input.isTerminal(event)) {
          terminalEvent = event;
        } else {
          yield event;
        }
      }
    }

    parser.feed(decoder.decode());
    parser.reset({ consume: true });
    assertParserHealthy(parserFailed);
    for (const event of drainEvents(pending, state, input.schema, input.isTerminal)) {
      if (input.isTerminal(event)) {
        terminalEvent = event;
      } else {
        yield event;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ExecutionHostProtocolError) {
      throw error;
    }
    throw toExecutionHostTransportError(error, input.signal);
  } finally {
    reader.releaseLock();
  }

  if (!state.accepted) {
    throw new ExecutionHostProtocolError(
      'Execution Host stream omitted the accepted event.',
    );
  }
  if (!state.terminal || !terminalEvent) {
    throw new ExecutionHostStreamInterruptedError();
  }
  // A terminal event is observable only after clean EOF. This keeps success
  // truthful if the transport appends malformed or post-terminal data.
  yield terminalEvent;
}

export function toExecutionHostTransportError(
  error: unknown,
  signal?: AbortSignal,
): Error {
  if (signal?.aborted || isAbortError(error)) {
    return new ExecutionHostInvocationCancelledError();
  }
  return new ExecutionHostStreamInterruptedError();
}

function* drainEvents<Event extends ExecutionHostEvent>(
  pending: EventSourceMessage[],
  state: StreamValidationState,
  schema: z.ZodType<Event>,
  isTerminal: (event: Event) => boolean,
): Generator<Event> {
  while (pending.length > 0) {
    yield validateEvent(pending.shift()!, state, schema, isTerminal);
  }
}

function validateEvent<Event extends ExecutionHostEvent>(
  frame: EventSourceMessage,
  state: StreamValidationState,
  schema: z.ZodType<Event>,
  isTerminal: (event: Event) => boolean,
): Event {
  let decoded: unknown;
  try {
    decoded = JSON.parse(frame.data) as unknown;
  } catch {
    throw new ExecutionHostProtocolError();
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new ExecutionHostProtocolError();
  }
  const event = parsed.data;
  const correctFrameMetadata = frame.event === event.kind
    && frame.id === String(event.sequence);
  const correctEnvelope = event.sequence === state.nextSequence
    && (!state.invocationId || event.invocationId === state.invocationId);
  if (!correctFrameMetadata || !correctEnvelope || state.terminal) {
    throw new ExecutionHostProtocolError();
  }

  if (!state.accepted) {
    if (event.kind !== 'accepted') {
      throw new ExecutionHostProtocolError();
    }
    state.accepted = true;
    state.invocationId = event.invocationId;
    state.runId = event.runId;
  } else if (event.kind === 'accepted' || event.runId !== state.runId) {
    throw new ExecutionHostProtocolError();
  }

  state.nextSequence += 1;
  state.terminal = isTerminal(event);
  return event;
}

function assertParserHealthy(failed: boolean): void {
  if (failed) {
    throw new ExecutionHostProtocolError();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
