import type {
  HostedConversationFailureCode,
  HostedConversationTurnStatus,
} from '@heddleagent/execution-host-client/conversation';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const heddlePostgresSchema = pgSchema('heddle');

const timestampColumn = (name: string) => timestamp(name, {
  mode: 'string',
  withTimezone: true,
});

/**
 * Atomic lifecycle authority for one Execution Host conversation invocation.
 *
 * Product history and query policy deliberately do not belong in this table.
 * Its columns are the exact safe projection accepted by the public lifecycle
 * store port, plus denormalized scope fields needed for SQL fencing.
 */
export const postgresExecutionHostConversationTurns =
  heddlePostgresSchema.table(
    'execution_host_conversation_turns',
    {
      invocationId: text('invocation_id').notNull(),
      tenantId: text('tenant_id').notNull(),
      subjectId: text('subject_id').notNull(),
      productSessionId: text('product_session_id').notNull(),
      prompt: text('prompt').notNull(),
      deadlineAt: timestampColumn('deadline_at'),
      status: text('status').$type<HostedConversationTurnStatus>().notNull(),
      runId: text('run_id'),
      summary: text('summary'),
      failureCode: text('failure_code').$type<HostedConversationFailureCode>(),
      requestedAt: timestampColumn('requested_at').notNull(),
      acceptedAt: timestampColumn('accepted_at'),
      settledAt: timestampColumn('settled_at'),
    },
    (table) => [
      primaryKey({
        columns: [table.invocationId],
        name: 'execution_host_conversation_turns_pk',
      }),
      index('execution_host_conversation_turns_expiry_idx').on(
        table.tenantId,
        table.subjectId,
        table.productSessionId,
        table.status,
        table.deadlineAt,
      ),
      check(
        'execution_host_conversation_turns_invocation_id_valid',
        sql`${table.invocationId} ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'`,
      ),
      check(
        'execution_host_conversation_turns_scope_valid',
        sql`${table.tenantId} ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'
          and ${table.subjectId} ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'
          and ${table.productSessionId} ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$'`,
      ),
      check(
        'execution_host_conversation_turns_prompt_valid',
        sql`char_length(btrim(${table.prompt})) between 1 and 200000`,
      ),
      check(
        'execution_host_conversation_turns_summary_valid',
        sql`${table.summary} is null or char_length(${table.summary}) <= 1000000`,
      ),
      check(
        'execution_host_conversation_turns_status_valid',
        sql`${table.status} in (
          'requested', 'running', 'completed', 'max_steps',
          'failed', 'cancelled', 'interrupted'
        )`,
      ),
      check(
        'execution_host_conversation_turns_failure_code_valid',
        sql`${table.failureCode} is null or ${table.failureCode} in (
          'execution_error', 'execution_failed', 'execution_result_error',
          'host_protocol_error', 'host_rejected', 'model_authentication',
          'model_context_window', 'model_empty_response', 'model_permission',
          'model_quota', 'model_rate_limit', 'model_request',
          'model_transport', 'model_unknown', 'deadline_elapsed',
          'execution_interrupted', 'invocation_aborted',
          'stream_ended_without_terminal', 'stream_interrupted',
          'invocation_cancelled'
        )`,
      ),
      check(
        'execution_host_conversation_turns_acceptance_complete',
        sql`(${table.runId} is null) = (${table.acceptedAt} is null)`,
      ),
      check(
        'execution_host_conversation_turns_state_shape_valid',
        sql`(
          ${table.status} = 'requested'
          and ${table.runId} is null
          and ${table.summary} is null
          and ${table.failureCode} is null
          and ${table.settledAt} is null
        ) or (
          ${table.status} = 'running'
          and ${table.runId} is not null
          and ${table.summary} is null
          and ${table.failureCode} is null
          and ${table.settledAt} is null
        ) or (
          ${table.status} in ('completed', 'max_steps')
          and ${table.runId} is not null
          and ${table.failureCode} is null
          and ${table.settledAt} is not null
        ) or (
          ${table.status} = 'failed'
          and ${table.failureCode} in (
            'execution_error', 'execution_failed', 'execution_result_error',
            'host_protocol_error', 'host_rejected', 'model_authentication',
            'model_context_window', 'model_empty_response',
            'model_permission', 'model_quota', 'model_rate_limit',
            'model_request', 'model_transport', 'model_unknown'
          )
          and ${table.settledAt} is not null
        ) or (
          ${table.status} = 'interrupted'
          and ${table.failureCode} in (
            'deadline_elapsed', 'execution_interrupted',
            'invocation_aborted', 'stream_ended_without_terminal',
            'stream_interrupted'
          )
          and ${table.settledAt} is not null
        ) or (
          ${table.status} = 'cancelled'
          and ${table.runId} is not null
          and ${table.summary} is null
          and ${table.failureCode} = 'invocation_cancelled'
          and ${table.settledAt} is not null
        )`,
      ),
    ],
  );

export const executionHostConversationPostgresTables = Object.freeze({
  turns: postgresExecutionHostConversationTurns,
});
