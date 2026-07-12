import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ConversationRunProtocolCodec } from '../protocol-codec.js';
import type {
  ConversationRunProtocolEvent,
  ConversationRunReference,
} from '../types.js';

export type ConversationRunHttpSseClientOptions<
  Accepted extends ConversationRunReference,
  Activity,
  Result,
  Cancellation,
> = {
  /** Base URL whose REST resource is `/runs`. Relative browser URLs are valid. */
  baseUrl: string;
  protocol: ConversationRunProtocolCodec<Activity, Result>;
  accepted: StandardSchemaV1<unknown, Accepted>;
  cancellation: StandardSchemaV1<unknown, Cancellation>;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof globalThis.fetch;
};

export type SubscribeConversationRunHttpSseInput<Activity, Result> = {
  runId: string;
  afterSequence?: number;
  signal?: AbortSignal;
  onEvent(event: ConversationRunProtocolEvent<Activity, Result>): void | Promise<void>;
};

export type ConversationRunHttpErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};
