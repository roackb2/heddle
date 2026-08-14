import { z } from 'zod';
import {
  ExecutionHostConversationTurnRequestSchema,
  ExecutionScopeSchema,
  OpaqueIdSchema,
  TimestampSchema,
  type ExecutionHostTerminalEvent,
} from '../contracts/index.js';
import type {
  HostedConversationTurnRunner,
} from './types.js';

export const HOSTED_CONVERSATION_TURN_STATUSES = [
  'requested',
  'running',
  'completed',
  'max_steps',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const HOSTED_CONVERSATION_FAILED_CODES = [
  'execution_error',
  'execution_failed',
  'execution_result_error',
  'host_protocol_error',
  'host_rejected',
  'model_authentication',
  'model_context_window',
  'model_empty_response',
  'model_permission',
  'model_quota',
  'model_rate_limit',
  'model_request',
  'model_transport',
  'model_unknown',
] as const;

export const HOSTED_CONVERSATION_INTERRUPTED_CODES = [
  'deadline_elapsed',
  'execution_interrupted',
  'invocation_aborted',
  'stream_ended_without_terminal',
  'stream_interrupted',
] as const;

export const HOSTED_CONVERSATION_CANCELLED_CODES = [
  'invocation_cancelled',
] as const;

export const HOSTED_CONVERSATION_FAILURE_CODES = [
  ...HOSTED_CONVERSATION_FAILED_CODES,
  ...HOSTED_CONVERSATION_INTERRUPTED_CODES,
  ...HOSTED_CONVERSATION_CANCELLED_CODES,
] as const;

export const HostedConversationTurnStatusSchema = z.enum(
  HOSTED_CONVERSATION_TURN_STATUSES,
);
export const HostedConversationFailureCodeSchema = z.enum(
  HOSTED_CONVERSATION_FAILURE_CODES,
);
export const HostedConversationPersistenceScopeSchema =
  ExecutionScopeSchema.omit({ adopterId: true });
export const HostedConversationTurnIdentitySchema = z.object({
  invocationId: OpaqueIdSchema,
  scope: HostedConversationPersistenceScopeSchema,
}).strict();
export const HostedConversationRequestedTurnSchema =
  HostedConversationTurnIdentitySchema.extend({
    prompt: ExecutionHostConversationTurnRequestSchema.shape.prompt,
    deadlineAt:
      ExecutionHostConversationTurnRequestSchema.shape.deadlineAt,
    requestedAt: TimestampSchema,
  }).strict();
export const HostedConversationAcceptedTurnSchema =
  HostedConversationTurnIdentitySchema.extend({
    runId: OpaqueIdSchema,
    acceptedAt: TimestampSchema,
  }).strict();

const SummarySchema = z.string().max(1_000_000);
const SettlementBaseSchema = HostedConversationTurnIdentitySchema.extend({
  settledAt: TimestampSchema,
});

export const HostedConversationTurnSettlementSchema = z.discriminatedUnion(
  'status',
  [
    SettlementBaseSchema.extend({
      status: z.literal('completed'),
      summary: SummarySchema.optional(),
    }).strict(),
    SettlementBaseSchema.extend({
      status: z.literal('max_steps'),
      summary: SummarySchema.optional(),
    }).strict(),
    SettlementBaseSchema.extend({
      status: z.literal('failed'),
      summary: SummarySchema.optional(),
      failureCode: z.enum(HOSTED_CONVERSATION_FAILED_CODES),
    }).strict(),
    SettlementBaseSchema.extend({
      status: z.literal('cancelled'),
      failureCode: z.literal(HOSTED_CONVERSATION_CANCELLED_CODES[0]),
    }).strict(),
    SettlementBaseSchema.extend({
      status: z.literal('interrupted'),
      summary: SummarySchema.optional(),
      failureCode: z.enum(HOSTED_CONVERSATION_INTERRUPTED_CODES),
    }).strict(),
  ],
);

export const HostedConversationExpiredTurnReconciliationSchema = z.object({
  scope: HostedConversationPersistenceScopeSchema,
  expiredBefore: TimestampSchema,
  settledAt: TimestampSchema,
}).strict();

export type HostedConversationTurnStatus = z.infer<
  typeof HostedConversationTurnStatusSchema
>;

export type HostedConversationTerminalStatus = Exclude<
  HostedConversationTurnStatus,
  'requested' | 'running'
>;

export type HostedConversationFailureCode = z.infer<
  typeof HostedConversationFailureCodeSchema
>;

export type HostedConversationPersistenceScope = z.infer<
  typeof HostedConversationPersistenceScopeSchema
>;

export type HostedConversationTurnIdentity = z.infer<
  typeof HostedConversationTurnIdentitySchema
>;

export type HostedConversationRequestedTurn = z.infer<
  typeof HostedConversationRequestedTurnSchema
>;

export type HostedConversationAcceptedTurn = z.infer<
  typeof HostedConversationAcceptedTurnSchema
>;

export type HostedConversationTurnSettlement = z.infer<
  typeof HostedConversationTurnSettlementSchema
>;

export type HostedConversationTurnLifecycleRecord =
  HostedConversationRequestedTurn & {
    status: HostedConversationTurnStatus;
    runId?: string;
    summary?: string;
    failureCode?: HostedConversationFailureCode;
    acceptedAt?: string;
    settledAt?: string;
  };

export type HostedConversationExpiredTurnReconciliation = z.infer<
  typeof HostedConversationExpiredTurnReconciliationSchema
>;

/**
 * Durable write port for the generic hosted-turn lifecycle.
 *
 * Implementations must fence every mutation by invocation and full scope.
 * Creation rejects every duplicate invocation so a repeated request cannot
 * start execution twice. Accepted and terminal writes allow only an exact
 * repeat; conflicting or late transitions must fail atomically. The port
 * deliberately cannot carry activity, raw errors, credentials, or tool data.
 */
export interface HostedConversationTurnLifecycleStore {
  createTurn(input: HostedConversationRequestedTurn): Promise<void>;
  recordAccepted(input: HostedConversationAcceptedTurn): Promise<void>;
  settleTurn(input: HostedConversationTurnSettlement): Promise<void>;
  interruptExpiredTurns(
    input: HostedConversationExpiredTurnReconciliation,
  ): Promise<void>;
}

export type DurableHostedConversationTurnServiceConfig = {
  turns: HostedConversationTurnRunner;
  store: HostedConversationTurnLifecycleStore;
  maxSummaryCharacters?: number;
  expiredTurnGraceMs?: number;
};

export type DurableHostedConversationTurnServiceOptions = {
  now?: () => Date;
};

export type HostedConversationTurnReconciliationOptions = {
  expiredTurnGraceMs?: number;
  now?: () => Date;
};

type ProjectedSettlement<T> = T extends HostedConversationTurnSettlement
  ? Omit<T, keyof HostedConversationTurnIdentity | 'settledAt'>
  : never;

export type HostedConversationTerminalProjection = {
  event: ExecutionHostTerminalEvent;
  settlement: ProjectedSettlement<HostedConversationTurnSettlement>;
};
