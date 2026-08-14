/** PostgreSQL implementation of Heddle's targeted heartbeat task-store port. */
import {
  HeartbeatTaskControlPolicy,
  HeartbeatTaskExecutionEligibilityPolicy,
  HeartbeatTaskStateProjector,
  type HeartbeatTask,
  type HeartbeatTaskRunRecord,
  type HeartbeatTargetedTaskStore,
} from '@heddleagent/runtime/advanced';
import {
  and,
  asc,
  desc,
  eq,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  postgresHeartbeatRunRecords as heartbeatRunRecords,
  postgresHeartbeatTasks as heartbeatTasks,
} from './schema.js';
import {
  HeartbeatPostgresContext,
  normalizeLimit,
  requireCurrentExecution,
  requireDate,
  requireNumber,
  requireText,
} from './internal/context.js';

export type PostgresHeartbeatTaskStore = HeartbeatTargetedTaskStore & Required<
  Pick<
    HeartbeatTargetedTaskStore,
    'saveRunRecord' | 'listRunRecords' | 'loadRunRecord'
  >
>;

/**
 * Creates the durable, claim-fenced worker store for one trusted namespace.
 *
 * It deliberately has no in-process run-request subscription. Durable requests
 * remain authoritative; a dispatcher supplies its own notification fast path.
 */
export function createPostgresHeartbeatTaskStore(
  context: HeartbeatPostgresContext,
): PostgresHeartbeatTaskStore {
  const store = {
    async listTasks(): Promise<HeartbeatTask[]> {
      const rows = await context.database
        .select()
        .from(heartbeatTasks)
        .where(eq(heartbeatTasks.namespace, context.namespace))
        .orderBy(asc(heartbeatTasks.taskId));
      return rows.map((row) => context.taskFromRow(row));
    },

    async loadTask(taskId: string): Promise<HeartbeatTask | undefined> {
      const [row] = await context.database
        .select()
        .from(heartbeatTasks)
        .where(context.taskIdentity(taskId))
        .limit(1);
      return row ? context.taskFromRow(row) : undefined;
    },

    async saveTask(task: HeartbeatTask): Promise<void> {
      const normalized = HeartbeatTaskStateProjector.normalize(task);
      const projection = context.persistenceProjection(
        normalized,
        context.leaseFromTask(normalized),
      );
      await context.database
        .insert(heartbeatTasks)
        .values({
          namespace: context.namespace,
          taskId: normalized.id,
          ...projection,
          createdAt: context.nowIso(),
        })
        .onConflictDoUpdate({
          target: [heartbeatTasks.namespace, heartbeatTasks.taskId],
          set: {
            ...projection,
            version: sql`${heartbeatTasks.version} + 1`,
          },
        });
    },

    async loadCheckpoint(task) {
      const [row] = await context.database
        .select({ checkpoint: heartbeatTasks.checkpoint })
        .from(heartbeatTasks)
        .where(context.taskIdentity(task.id))
        .limit(1);
      return row?.checkpoint ?? undefined;
    },

    async saveCheckpoint(task, checkpoint): Promise<void> {
      const saved = await context.database
        .update(heartbeatTasks)
        .set({
          checkpoint,
          updatedAt: context.nowIso(),
          version: sql`${heartbeatTasks.version} + 1`,
        })
        .where(context.taskIdentity(task.id))
        .returning({ taskId: heartbeatTasks.taskId });
      if (saved.length === 0) {
        throw new Error(`Heartbeat task not found: ${task.id}`);
      }
    },

    async requestTaskRun(taskId, options = {}) {
      return await context.database.transaction(async (transaction) => {
        const row = await context.lockTask(transaction, taskId);
        if (!row) {
          throw new Error(`Heartbeat task not found: ${taskId}`);
        }
        const projected = HeartbeatTaskControlPolicy.requestTaskRun({
          task: context.taskFromRow(row),
          options,
          now: context.nowDate(),
        });
        await context.writeTask(transaction, projected.task, {
          leaseExpiresAt: row.leaseExpiresAt,
        });
        return projected;
      });
    },

    async claimTaskExecution(input) {
      const claimedAt = requireDate(
        input.claimedAt,
        'Heartbeat claim timestamp',
      );
      return await context.database.transaction(async (transaction) => {
        const row = await context.lockTask(transaction, input.taskId);
        if (!row) {
          return { status: 'not-found' } as const;
        }
        const task = context.taskFromRow(row);
        if (!task.enabled) {
          return { status: 'disabled' } as const;
        }
        if (task.state?.status === 'running') {
          return { status: 'busy' } as const;
        }
        if (input.claimMode === 'due') {
          const eligibility = HeartbeatTaskExecutionEligibilityPolicy.evaluate(
            task,
            claimedAt,
          );
          if (!eligibility.eligible) {
            return eligibility.reason === 'not-due'
              ? { status: 'not-due', task } as const
              : { status: eligibility.reason } as const;
          }
        }

        const runningTask = HeartbeatTaskStateProjector.markRunning({
          task,
          now: claimedAt,
          loadedCheckpoint: input.loadedCheckpoint,
          execution: input.execution,
        });
        await context.writeTask(transaction, runningTask, {
          leaseExpiresAt: context.leaseExpiresAt(claimedAt),
        });
        return { status: 'claimed', task: runningTask } as const;
      });
    },

    async completeTaskExecution(input) {
      const completedAt = requireDate(
        input.completedAt,
        'Heartbeat completion timestamp',
      );
      return await context.database.transaction(async (transaction) => {
        const row = await context.lockTask(transaction, input.taskId);
        if (!row || !context.executionMatches(row, input.execution)) {
          return { status: 'claim-lost' } as const;
        }
        if (input.signal?.aborted) {
          return { status: 'cancelled' } as const;
        }

        const task = context.taskFromRow(row);
        const execution = requireCurrentExecution(task, input.execution);
        const nextTask = HeartbeatTaskStateProjector.afterResult({
          task,
          execution,
          result: input.result,
          now: completedAt,
          loadedCheckpoint: input.loadedCheckpoint,
        });
        const outcome = nextTask.state?.lastExecution;
        const record: HeartbeatTaskRunRecord = {
          task: nextTask,
          result: input.result,
          loadedCheckpoint: input.loadedCheckpoint,
          outcome: outcome?.kind === 'agent'
            && outcome.executionId === input.execution.executionId
            ? outcome
            : {
              kind: 'agent',
              executionId: input.execution.executionId,
              summary: input.result.summary,
              finishedAt: input.result.state.finishedAt,
              runRequestGeneration: execution.runRequestGeneration,
            },
        };
        await context.writeTask(transaction, nextTask, {
          leaseExpiresAt: null,
          checkpoint: input.checkpoint,
        });
        await context.insertRunRecord(transaction, record);
        return { status: 'saved', task: nextTask, record } as const;
      });
    },

    async failTaskExecution(input) {
      const failedAt = requireDate(
        input.failedAt,
        'Heartbeat failure timestamp',
      );
      return await context.database.transaction(async (transaction) => {
        const row = await context.lockTask(transaction, input.taskId);
        if (!row || !context.executionMatches(row, input.execution)) {
          return { status: 'claim-lost' } as const;
        }
        if (input.signal?.aborted) {
          return { status: 'cancelled' } as const;
        }

        const task = context.taskFromRow(row);
        const nextTask = HeartbeatTaskStateProjector.afterFailure({
          task,
          execution: requireCurrentExecution(task, input.execution),
          error: input.error,
          now: failedAt,
          retryMs: input.retryMs,
        });
        await context.writeTask(transaction, nextTask, {
          leaseExpiresAt: null,
        });
        return { status: 'saved', task: nextTask } as const;
      });
    },

    async recordTaskExecutionOutcome(input) {
      const finishedAt = requireDate(
        input.finishedAt,
        'Heartbeat outcome timestamp',
      );
      return await context.database.transaction(async (transaction) => {
        const row = await context.lockTask(transaction, input.taskId);
        if (!row || !context.executionMatches(row, input.execution)) {
          return { status: 'claim-lost' } as const;
        }
        if (input.signal?.aborted) {
          return { status: 'cancelled' } as const;
        }

        const task = context.taskFromRow(row);
        const execution = requireCurrentExecution(task, input.execution);
        const project = {
          skipped: () => HeartbeatTaskStateProjector.afterSkip({
            task,
            execution,
            summary: input.summary,
            now: finishedAt,
          }),
          cancelled: () => HeartbeatTaskStateProjector.afterCancellation({
            task,
            execution,
            summary: input.summary,
            reason: input.reason,
            now: finishedAt,
          }),
          retry: () => HeartbeatTaskStateProjector.afterHandlerRetry({
            task,
            execution,
            summary: input.summary,
            agentRunId: requireText(
              input.agentRunId,
              'Heartbeat retry agent run id',
            ),
            retryMs: requireNumber(
              input.retryMs,
              'Heartbeat retry delay',
            ),
            now: finishedAt,
          }),
          blocked: () => HeartbeatTaskStateProjector.afterHandlerBlock({
            task,
            execution,
            summary: input.summary,
            agentRunId: requireText(
              input.agentRunId,
              'Heartbeat blocked agent run id',
            ),
            now: finishedAt,
          }),
        } satisfies Record<typeof input.kind, () => HeartbeatTask>;
        const nextTask = project[input.kind]();
        const outcome = nextTask.state?.lastExecution;
        if (!outcome || outcome.kind !== input.kind) {
          throw new Error(
            `Heartbeat task ${input.taskId} did not project a ${input.kind} execution outcome.`,
          );
        }
        const record: HeartbeatTaskRunRecord = { task: nextTask, outcome };
        await context.writeTask(transaction, nextTask, {
          leaseExpiresAt: null,
        });
        await context.insertRunRecord(transaction, record);
        return { status: 'saved', task: nextTask, record } as const;
      });
    },

    async recoverInterruptedTasks(input) {
      const recoveredAt = requireDate(
        input.recoveredAt,
        'Heartbeat recovery timestamp',
      );
      return await context.database.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(heartbeatTasks)
          .where(and(
            eq(heartbeatTasks.namespace, context.namespace),
            eq(heartbeatTasks.status, 'running'),
            lte(heartbeatTasks.leaseExpiresAt, recoveredAt.toISOString()),
          ))
          .for('update', { skipLocked: true });
        const recovered = [];
        for (const row of rows) {
          const projected = HeartbeatTaskStateProjector.afterRecovery({
            task: context.taskFromRow(row),
            now: recoveredAt,
            reason: input.reason,
          });
          await context.writeTask(transaction, projected.task, {
            leaseExpiresAt: null,
          });
          recovered.push(projected);
        }
        return recovered;
      });
    },

    async saveRunRecord(record): Promise<void> {
      await context.insertRunRecord(context.database, record);
    },

    async listRunRecords(options = {}) {
      const limit = normalizeLimit(options.limit);
      const predicate = options.taskId
        ? and(
          eq(heartbeatRunRecords.namespace, context.namespace),
          eq(heartbeatRunRecords.taskId, options.taskId),
        )
        : eq(heartbeatRunRecords.namespace, context.namespace);
      const query = context.database
        .select()
        .from(heartbeatRunRecords)
        .where(predicate)
        .orderBy(
          desc(heartbeatRunRecords.createdAt),
          desc(heartbeatRunRecords.id),
        );
      const rows = limit ? await query.limit(limit) : await query;
      return rows.map((row) => context.runRecordEntry(row));
    },

    async loadRunRecord(id) {
      const [row] = await context.database
        .select()
        .from(heartbeatRunRecords)
        .where(and(
          eq(heartbeatRunRecords.namespace, context.namespace),
          or(
            eq(heartbeatRunRecords.id, id),
            eq(heartbeatRunRecords.executionId, id),
            eq(heartbeatRunRecords.runId, id),
          ),
        ))
        .orderBy(desc(heartbeatRunRecords.createdAt))
        .limit(1);
      return row ? context.runRecordEntry(row) : undefined;
    },
  } satisfies PostgresHeartbeatTaskStore;

  return Object.freeze(store);
}
