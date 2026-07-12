import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import type {
  ConversationRunSseEvent,
  ParseConversationRunSseReplayCursorInput,
  StreamConversationRunSseOptions,
} from './types.js';

const ReplayCursorPattern = /^(0|[1-9]\d*)$/;

/** An explicit query or Last-Event-ID replay cursor is malformed. */
export class ConversationRunSseReplayCursorError extends Error {
  readonly name = 'ConversationRunSseReplayCursorError';

  constructor(readonly value: unknown) {
    super('Conversation run replay cursor must be a non-negative safe integer.');
  }
}

/**
 * Parses the conventional SSE replay cursor. An explicit query value takes
 * precedence over Last-Event-ID so fetch clients can choose their checkpoint.
 */
export function parseConversationRunSseReplayCursor(
  input: ParseConversationRunSseReplayCursorInput,
): number | undefined {
  const value = input.query !== undefined ? input.query : input.lastEventId;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !ReplayCursorPattern.test(value)) {
    throw new ConversationRunSseReplayCursorError(value);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConversationRunSseReplayCursorError(value);
  }
  return parsed;
}

/**
 * Streams one canonical conversation run over Node HTTP SSE.
 *
 * Request abort and response close stop only this subscription. The run keeps
 * executing until its run handle is explicitly cancelled. A subscribe failure
 * happens before headers so the host can still send its own JSON error policy.
 */
export async function streamConversationRunSse<Event extends ConversationRunSseEvent>(
  options: StreamConversationRunSseOptions<Event>,
): Promise<void> {
  const connection = new AbortController();
  const abortConnection = () => connection.abort();
  options.request.once('aborted', abortConnection);
  options.response.once('close', abortConnection);
  const signal = options.signal
    ? AbortSignal.any([connection.signal, options.signal])
    : connection.signal;

  try {
    const events = options.subscribe(signal);
    setSseHeaders(options.response);
    for await (const event of events) {
      await writeSseEvent(options.response, options.protocol, event, signal);
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    options.request.off('aborted', abortConnection);
    options.response.off('close', abortConnection);
    if (options.response.headersSent) {
      endResponse(options.response);
    }
  }
}

function setSseHeaders(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
}

async function writeSseEvent<Event extends ConversationRunSseEvent>(
  response: ServerResponse,
  protocol: StreamConversationRunSseOptions<Event>['protocol'],
  event: Event,
  signal: AbortSignal,
): Promise<void> {
  const frame = `event: ${event.kind}\nid: ${event.sequence}\ndata: ${protocol.stringifyEvent(event)}\n\n`;
  if (!response.write(frame)) {
    await once(response, 'drain', { signal });
  }
}

function endResponse(response: ServerResponse): void {
  if (!response.destroyed && !response.writableEnded) {
    response.end();
  }
}
