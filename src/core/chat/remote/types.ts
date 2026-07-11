import type { StandardSchemaV1 } from '@standard-schema/spec';

export type ConversationRunReference = {
  runId: string;
};

export type ConversationRunProtocolEventKind = 'activity' | 'result' | 'cancelled' | 'error';

export type ConversationRunConsumerEvent = {
  runId: string;
  sequence: number;
  kind: ConversationRunProtocolEventKind;
};

export type ConversationRunSubscriptionInput<Reference extends ConversationRunReference> =
  Reference & { afterSequence: number };

export type ConversationRunConsumerRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type ConversationRunConsumerServiceOptions = {
  retry?: ConversationRunConsumerRetryOptions;
};

export type ConversationRunConsumerSelectionOptions = {
  afterSequence?: number;
};

export type ConversationRunRetry<Reference extends ConversationRunReference> = {
  attempt: number;
  delayMs: number;
  input: ConversationRunSubscriptionInput<Reference>;
};

export type ConversationRunEventAcceptance = {
  accepted: boolean;
  terminal: boolean;
};

export type ConversationRunProtocolEnvelope = {
  runId: string;
  sequence: number;
  timestamp: string;
};

export type ConversationRunProtocolError = {
  code: string;
  message: string;
};

export type ConversationRunProtocolEvent<Activity, Result> =
  | (ConversationRunProtocolEnvelope & {
    kind: 'activity';
    activity: Activity;
  })
  | (ConversationRunProtocolEnvelope & {
    kind: 'result';
    result: Result;
  })
  | (ConversationRunProtocolEnvelope & {
    kind: 'cancelled';
    reason: string;
  })
  | (ConversationRunProtocolEnvelope & {
    kind: 'error';
    error: ConversationRunProtocolError;
  });

export type ConversationRunProtocolCodecOptions<Activity, Result> = {
  activity: StandardSchemaV1<unknown, Activity>;
  result: StandardSchemaV1<unknown, Result>;
};

export type ConversationRunProtocolSafeParseResult<Activity, Result> =
  | {
    success: true;
    data: ConversationRunProtocolEvent<Activity, Result>;
  }
  | {
    success: false;
    error: Error;
  };

export type ConversationRunProtocolEventSchema<Activity, Result> =
  StandardSchemaV1<unknown, ConversationRunProtocolEvent<Activity, Result>> & {
    parse(input: unknown): ConversationRunProtocolEvent<Activity, Result>;
    safeParse(input: unknown): ConversationRunProtocolSafeParseResult<Activity, Result>;
  };
