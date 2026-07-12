import type { IncomingMessage, ServerResponse } from 'node:http';

export type ConversationRunSseEvent = {
  kind: string;
  sequence: number;
};

export type ConversationRunSseProtocol = {
  stringifyEvent(input: unknown): string;
};

export type StreamConversationRunSseOptions<Event extends ConversationRunSseEvent> = {
  request: IncomingMessage;
  response: ServerResponse;
  protocol: ConversationRunSseProtocol;
  subscribe(signal: AbortSignal): AsyncIterable<Event>;
  signal?: AbortSignal;
};

export type ParseConversationRunSseReplayCursorInput = {
  /** Explicit query value. When present, it wins over Last-Event-ID. */
  query?: unknown;
  lastEventId?: unknown;
};
