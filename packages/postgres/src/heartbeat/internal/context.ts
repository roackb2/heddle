import { randomUUID } from 'node:crypto';
import {
  HeartbeatTaskStateProjector,
  type AgentLoopCheckpoint,
  type HeartbeatTask,
  type HeartbeatTaskExecution,
  type HeartbeatTaskRunRecord,
  type HeartbeatTaskRunRecordEntry,
} from '@heddleagent/runtime/advanced';
import dayjs from 'dayjs';
import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from 'drizzle-orm';
import type {
  PgQueryResultHKT,
  PgTransaction,
} from 'drizzle-orm/pg-core/session';
import type { ExtractTablesWithRelations } from 'drizzle-orm/relations';
import {
  postgresHeartbeatRunRecords as heartbeatRunRecords,
  postgresHeartbeatTasks as heartbeatTasks,
} from '../schema.js';
import type {
  HeartbeatPostgresDatabase,
  PostgresHeartbeatTaskAuthorityOptions,
} from '../types.js';

export type HeartbeatTaskRow = typeof heartbeatTasks.$inferSelect;
export type HeartbeatRunRecordRow = typeof heartbeatRunRecords.$inferSelect;
export type HeartbeatPostgresTransaction = PgTransaction<
  PgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

export type WriteTaskOptions = {
  leaseExpiresAt: string | null;
  checkpoint?: AgentLoopCheckpoint;
};

/**
 * Shared PostgreSQL invariants for the execution-store and administration ports.
 *
 * This collaborator owns row identity, locking, denormalized fencing columns,
 * lease projection, and run-record serialization. Product policy never enters
 * this layer.
 */
export class HeartbeatPostgresContext {
  readonly database: HeartbeatPostgresDatabase;
  readonly namespace: string;
  readonly executionLeaseMs: number;
  readonly now: () => Date;
  readonly createRunRecordId: () => string;

  constructor(options: PostgresHeartbeatTaskAuthorityOptions) {
    this.database = options.database;
    this.namespace = normalizeNamespace(options.namespace);
    this.executionLeaseMs = requirePositiveSafeInteger(
      options.executionLeaseMs,
      'Heartbeat execution lease',
    );
    this.now = options.now ?? (() => new Date());
    this.createRunRecordId = options.createRunRecordId ?? randomUUID;
  }

  taskIdentity(taskId: string) {
    return and(
      eq(heartbeatTasks.namespace, this.namespace),
      eq(heartbeatTasks.taskId, taskId),
    );
  }

  async lockTask(
    transaction: HeartbeatPostgresTransaction,
    taskId: string,
  ): Promise<HeartbeatTaskRow | undefined> {
    const [row] = await transaction
      .select()
      .from(heartbeatTasks)
      .where(this.taskIdentity(taskId))
      .for('update')
      .limit(1);
    return row;
  }

  /** Serializes namespace-wide membership changes across API processes. */
  async lockTaskCatalog(
    transaction: HeartbeatPostgresTransaction,
  ): Promise<void> {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(
        hashtext('heddle-postgres-task-catalog'),
        hashtext(${this.namespace})
      )`,
    );
  }

  async lockNamespaceTasks(
    transaction: HeartbeatPostgresTransaction,
  ): Promise<HeartbeatTaskRow[]> {
    return await transaction
      .select()
      .from(heartbeatTasks)
      .where(eq(heartbeatTasks.namespace, this.namespace))
      .orderBy(asc(heartbeatTasks.taskId))
      .for('update');
  }

  async insertTask(
    transaction: HeartbeatPostgresTransaction,
    task: HeartbeatTask,
  ): Promise<void> {
    const normalized = HeartbeatTaskStateProjector.normalize(task);
    await transaction.insert(heartbeatTasks).values({
      namespace: this.namespace,
      taskId: normalized.id,
      ...this.persistenceProjection(normalized, this.leaseFromTask(normalized)),
      createdAt: this.nowIso(),
    });
  }

  async deleteTasks(
    transaction: HeartbeatPostgresTransaction,
    taskIds: readonly string[],
  ): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }
    await transaction.delete(heartbeatRunRecords).where(and(
      eq(heartbeatRunRecords.namespace, this.namespace),
      inArray(heartbeatRunRecords.taskId, [...taskIds]),
    ));
    await transaction.delete(heartbeatTasks).where(and(
      eq(heartbeatTasks.namespace, this.namespace),
      inArray(heartbeatTasks.taskId, [...taskIds]),
    ));
  }

  async writeTask(
    transaction: HeartbeatPostgresTransaction,
    task: HeartbeatTask,
    options: WriteTaskOptions,
  ): Promise<void> {
    const checkpoint = options.checkpoint === undefined
      ? {}
      : { checkpoint: options.checkpoint };
    const updated = await transaction
      .update(heartbeatTasks)
      .set({
        ...this.persistenceProjection(task, options.leaseExpiresAt),
        ...checkpoint,
        version: sql`${heartbeatTasks.version} + 1`,
      })
      .where(this.taskIdentity(task.id))
      .returning({ taskId: heartbeatTasks.taskId });
    if (updated.length === 0) {
      throw new Error(`Heartbeat task not found: ${task.id}`);
    }
  }

  persistenceProjection(
    task: HeartbeatTask,
    leaseExpiresAt: string | null,
  ) {
    const normalized = HeartbeatTaskStateProjector.normalize(task);
    const status = normalized.state?.status ?? 'idle';
    const execution = normalized.state?.execution;
    if (status === 'running' && !execution) {
      throw new Error(
        `Running heartbeat task ${normalized.id} is missing its execution identity.`,
      );
    }
    if (status === 'running' && !leaseExpiresAt) {
      throw new Error(
        `Running heartbeat task ${normalized.id} is missing its execution lease.`,
      );
    }

    return {
      task: normalized,
      enabled: normalized.enabled,
      status,
      nextRunAt: normalizeOptionalTimestamp(
        normalized.schedule.nextRunAt,
        `Heartbeat task ${normalized.id} next-run timestamp`,
      ),
      executionId: status === 'running' ? execution?.executionId : null,
      executionOwnerId: status === 'running' ? execution?.ownerId : null,
      leaseExpiresAt: status === 'running' ? leaseExpiresAt : null,
      updatedAt: normalizeOptionalTimestamp(
        normalized.state?.updatedAt,
        `Heartbeat task ${normalized.id} update timestamp`,
      ) ?? this.nowIso(),
    };
  }

  taskFromRow(row: HeartbeatTaskRow): HeartbeatTask {
    const task = HeartbeatTaskStateProjector.normalize(row.task);
    if (task.id !== row.taskId) {
      throw new Error(
        `Heartbeat task row ${row.taskId} contains mismatched task ${task.id}.`,
      );
    }
    const execution = task.state?.execution;
    const consistent = row.status === (task.state?.status ?? 'idle')
      && row.enabled === task.enabled
      && row.executionId === (execution?.executionId ?? null)
      && row.executionOwnerId === (execution?.ownerId ?? null);
    if (!consistent) {
      throw new Error(
        `Heartbeat task row ${row.taskId} has inconsistent fencing columns.`,
      );
    }
    return task;
  }

  executionMatches(
    row: HeartbeatTaskRow,
    execution: HeartbeatTaskExecution,
  ): boolean {
    return row.status === 'running'
      && row.executionId === execution.executionId
      && row.executionOwnerId === execution.ownerId
      && row.task.state?.execution?.executionId === execution.executionId
      && row.task.state.execution.ownerId === execution.ownerId;
  }

  leaseFromTask(task: HeartbeatTask): string | null {
    if (task.state?.status !== 'running') {
      return null;
    }
    const claimedAt = requireDate(
      task.state.execution?.claimedAt,
      `Heartbeat task ${task.id} claim timestamp`,
    );
    return this.leaseExpiresAt(claimedAt);
  }

  leaseExpiresAt(claimedAt: Date): string {
    return dayjs(claimedAt)
      .add(this.executionLeaseMs, 'millisecond')
      .toISOString();
  }

  async insertRunRecord(
    database: Pick<HeartbeatPostgresDatabase, 'insert'>,
    record: HeartbeatTaskRunRecord,
  ): Promise<void> {
    const details = resolveRunRecord(record);
    await database.insert(heartbeatRunRecords).values({
      namespace: this.namespace,
      id: this.createRunRecordId(),
      taskId: record.task.id,
      workspaceId: record.task.workspaceId,
      executionId: details.executionId,
      runId: record.result?.state.runId,
      createdAt: requireDate(
        details.finishedAt,
        'Heartbeat run-record completion timestamp',
      ).toISOString(),
      record,
    });
  }

  runRecordEntry(row: HeartbeatRunRecordRow): HeartbeatTaskRunRecordEntry {
    return {
      id: row.id,
      path: `heddle-postgres://${encodeURIComponent(this.namespace)}/runs/${row.id}`,
      taskId: row.taskId,
      workspaceId: row.workspaceId ?? undefined,
      executionId: row.executionId,
      runId: row.runId ?? undefined,
      createdAt: row.createdAt,
      record: row.record,
    };
  }

  nowDate(): Date {
    return requireDate(this.now(), 'Heartbeat persistence clock');
  }

  nowIso(): string {
    return this.nowDate().toISOString();
  }
}

export function requireCurrentExecution(
  task: HeartbeatTask,
  fallback: HeartbeatTaskExecution,
): HeartbeatTaskExecution {
  return task.state?.execution ?? fallback;
}

export function requireDate(
  value: Date | string | undefined,
  label: string,
): Date {
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    throw new Error(`${label} must be valid.`);
  }
  return parsed.toDate();
}

export function requireText(
  value: string | undefined,
  label: string,
): string {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

export function requireNumber(
  value: number | undefined,
  label: string,
): number {
  if (value === undefined) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

export function normalizeLimit(limit: number | undefined): number | undefined {
  return limit === undefined
    ? undefined
    : requirePositiveSafeInteger(limit, 'Heartbeat run-record limit');
}

function normalizeNamespace(namespace: string): string {
  const normalized = namespace.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error(
      'Heartbeat store namespace must contain 1 to 200 characters.',
    );
  }
  return normalized;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeOptionalTimestamp(
  value: string | undefined,
  label: string,
): string | null {
  return value === undefined ? null : requireDate(value, label).toISOString();
}

function resolveRunRecord(record: HeartbeatTaskRunRecord) {
  if (record.outcome) {
    return record.outcome;
  }
  if (!record.result) {
    throw new Error(
      `Heartbeat record for task ${record.task.id} has no outcome.`,
    );
  }
  return {
    executionId: record.result.state.runId,
    finishedAt: record.result.state.finishedAt,
  };
}
