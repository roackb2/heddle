import {
  HostedConversationAcceptedTurnSchema,
  HostedConversationExpiredTurnReconciliationSchema,
  HostedConversationRequestedTurnSchema,
  HostedConversationTurnSettlementSchema,
  type HostedConversationAcceptedTurn,
  type HostedConversationExpiredTurnReconciliation,
  type HostedConversationFailureCode,
  type HostedConversationPersistenceScope,
  type HostedConversationRequestedTurn,
  type HostedConversationTurnSettlement,
} from '@heddleagent/execution-host-client/conversation';
import dayjs from 'dayjs';
import {
  and,
  eq,
  inArray,
  lt,
} from 'drizzle-orm';
import type {
  PgQueryResultHKT,
  PgTransaction,
} from 'drizzle-orm/pg-core/session';
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations';
import {
  postgresExecutionHostConversationTurns as turns,
} from './schema.js';
import type {
  PostgresHostedConversationTurnLifecycleStore,
  PostgresHostedConversationTurnLifecycleStoreOptions,
} from './types.js';

type TurnRow = typeof turns.$inferSelect;
type ConversationPostgresTransaction = PgTransaction<
  PgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

const OPEN_STATUSES = ['requested', 'running'] as const;

/**
 * Creates the atomic PostgreSQL implementation of the hosted-turn lifecycle.
 *
 * The caller supplies a trusted Drizzle database handle and remains
 * responsible for pool lifecycle and migration execution. Every mutation is
 * fenced by the global invocation identity and the full authorized scope.
 */
export function createPostgresHostedConversationTurnLifecycleStore(
  options: PostgresHostedConversationTurnLifecycleStoreOptions,
): PostgresHostedConversationTurnLifecycleStore {
  const { database } = options;

  return Object.freeze({
    async createTurn(rawInput: HostedConversationRequestedTurn): Promise<void> {
      const input = HostedConversationRequestedTurnSchema.parse(rawInput);
      await database.insert(turns).values({
        invocationId: input.invocationId,
        ...input.scope,
        prompt: input.prompt,
        deadlineAt: normalizeOptionalTimestamp(input.deadlineAt),
        status: 'requested',
        requestedAt: normalizeTimestamp(input.requestedAt),
      });
    },

    async recordAccepted(
      rawInput: HostedConversationAcceptedTurn,
    ): Promise<void> {
      const input = HostedConversationAcceptedTurnSchema.parse(rawInput);
      const acceptedAt = normalizeTimestamp(input.acceptedAt);
      await database.transaction(async (transaction) => {
        const row = await lockScopedTurn(transaction, input);
        if (
          row.status === 'running'
          && row.runId === input.runId
          && sameTimestamp(row.acceptedAt, acceptedAt)
        ) {
          return;
        }
        if (row.status !== 'requested') {
          throw invalidTransition(input.invocationId, 'accepted');
        }

        const updated = await transaction
          .update(turns)
          .set({
            status: 'running',
            runId: input.runId,
            acceptedAt,
          })
          .where(and(
            scopedIdentity(input.invocationId, input.scope),
            eq(turns.status, 'requested'),
          ))
          .returning({ invocationId: turns.invocationId });
        requireSingleMutation(updated, input.invocationId, 'accepted');
      });
    },

    async settleTurn(
      rawInput: HostedConversationTurnSettlement,
    ): Promise<void> {
      const input = HostedConversationTurnSettlementSchema.parse(rawInput);
      const settledAt = normalizeTimestamp(input.settledAt);
      const summary = readSummary(input);
      const failureCode = readFailureCode(input);
      await database.transaction(async (transaction) => {
        const row = await lockScopedTurn(transaction, input);
        if (
          !isOpen(row.status)
          && row.status === input.status
          && row.summary === summary
          && row.failureCode === failureCode
          && sameTimestamp(row.settledAt, settledAt)
        ) {
          return;
        }
        if (!isOpen(row.status)) {
          throw invalidTransition(input.invocationId, input.status);
        }
        if (
          row.status === 'requested'
          && !['failed', 'interrupted'].includes(input.status)
        ) {
          throw invalidTransition(input.invocationId, input.status);
        }

        const updated = await transaction
          .update(turns)
          .set({
            status: input.status,
            summary,
            failureCode,
            settledAt,
          })
          .where(and(
            scopedIdentity(input.invocationId, input.scope),
            eq(turns.status, row.status),
          ))
          .returning({ invocationId: turns.invocationId });
        requireSingleMutation(updated, input.invocationId, input.status);
      });
    },

    async interruptExpiredTurns(
      rawInput: HostedConversationExpiredTurnReconciliation,
    ): Promise<void> {
      const input = HostedConversationExpiredTurnReconciliationSchema.parse(
        rawInput,
      );
      await database
        .update(turns)
        .set({
          status: 'interrupted',
          summary: null,
          failureCode: 'deadline_elapsed',
          settledAt: normalizeTimestamp(input.settledAt),
        })
        .where(and(
          scopeIdentity(input.scope),
          inArray(turns.status, [...OPEN_STATUSES]),
          lt(turns.deadlineAt, normalizeTimestamp(input.expiredBefore)),
        ));
    },
  });
}

async function lockScopedTurn(
  transaction: ConversationPostgresTransaction,
  input: {
    invocationId: string;
    scope: HostedConversationPersistenceScope;
  },
): Promise<TurnRow> {
  const [row] = await transaction
    .select()
    .from(turns)
    .where(eq(turns.invocationId, input.invocationId))
    .for('update')
    .limit(1);
  if (!row || !sameScope(row, input.scope)) {
    throw new Error('Hosted conversation invocation is unavailable in scope.');
  }
  return row;
}

function scopedIdentity(
  invocationId: string,
  scope: HostedConversationPersistenceScope,
) {
  return and(eq(turns.invocationId, invocationId), scopeIdentity(scope));
}

function scopeIdentity(scope: HostedConversationPersistenceScope) {
  return and(
    eq(turns.tenantId, scope.tenantId),
    eq(turns.subjectId, scope.subjectId),
    eq(turns.productSessionId, scope.productSessionId),
  );
}

function sameScope(
  row: Pick<TurnRow, 'tenantId' | 'subjectId' | 'productSessionId'>,
  scope: HostedConversationPersistenceScope,
): boolean {
  return row.tenantId === scope.tenantId
    && row.subjectId === scope.subjectId
    && row.productSessionId === scope.productSessionId;
}

function isOpen(status: TurnRow['status']): boolean {
  return OPEN_STATUSES.includes(status as typeof OPEN_STATUSES[number]);
}

function readSummary(
  settlement: HostedConversationTurnSettlement,
): string | null {
  return 'summary' in settlement ? settlement.summary ?? null : null;
}

function readFailureCode(
  settlement: HostedConversationTurnSettlement,
): HostedConversationFailureCode | null {
  return 'failureCode' in settlement ? settlement.failureCode : null;
}

function normalizeTimestamp(value: string): string {
  return dayjs(value).toISOString();
}

function normalizeOptionalTimestamp(value: string | undefined): string | null {
  return value === undefined ? null : normalizeTimestamp(value);
}

function sameTimestamp(left: string | null, right: string): boolean {
  return left !== null && normalizeTimestamp(left) === right;
}

function invalidTransition(invocationId: string, transition: string): Error {
  return new Error(
    `Hosted conversation invocation ${invocationId} cannot transition to ${transition}.`,
  );
}

function requireSingleMutation(
  rows: readonly unknown[],
  invocationId: string,
  transition: string,
): void {
  if (rows.length !== 1) {
    throw new Error(
      `Hosted conversation invocation ${invocationId} lost its ${transition} transition fence.`,
    );
  }
}
