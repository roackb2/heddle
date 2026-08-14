/**
 * Driver-neutral Drizzle schema for Heddle's PostgreSQL heartbeat authority.
 *
 * Heddle owns the JSON task, checkpoint, and run-record contracts. PostgreSQL
 * columns denormalize only the fields required to target, claim, fence, and
 * recover an execution atomically.
 */
import type {
  AgentLoopCheckpoint,
  HeartbeatTask,
  HeartbeatTaskRunRecord,
} from '@heddleagent/runtime/advanced';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const heddlePostgresSchema = pgSchema('heddle');

const timestampColumn = (name: string) => timestamp(name, {
  mode: 'string',
  withTimezone: true,
});

export const postgresHeartbeatTasks = heddlePostgresSchema.table(
  'heartbeat_tasks',
  {
    namespace: text('namespace').notNull(),
    taskId: text('task_id').notNull(),
    task: jsonb('task').$type<HeartbeatTask>().notNull(),
    enabled: boolean('enabled').notNull(),
    status: text('status').notNull(),
    nextRunAt: timestampColumn('next_run_at'),
    executionId: text('execution_id'),
    executionOwnerId: text('execution_owner_id'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    checkpoint: jsonb('checkpoint').$type<AgentLoopCheckpoint>(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace, table.taskId],
      name: 'heartbeat_tasks_pk',
    }),
    index('heartbeat_tasks_due_idx').on(
      table.namespace,
      table.enabled,
      table.status,
      table.nextRunAt,
    ),
    index('heartbeat_tasks_recovery_idx').on(
      table.namespace,
      table.status,
      table.leaseExpiresAt,
    ),
    check(
      'heartbeat_tasks_status_valid',
      sql`${table.status} in ('idle', 'running', 'waiting', 'blocked', 'complete', 'failed')`,
    ),
    check('heartbeat_tasks_version_positive', sql`${table.version} >= 1`),
    check(
      'heartbeat_tasks_execution_lease_complete',
      sql`(
        ${table.status} = 'running'
        and ${table.executionId} is not null
        and ${table.executionOwnerId} is not null
        and ${table.leaseExpiresAt} is not null
      ) or (
        ${table.status} <> 'running'
        and ${table.executionId} is null
        and ${table.executionOwnerId} is null
        and ${table.leaseExpiresAt} is null
      )`,
    ),
  ],
);

export const postgresHeartbeatRunRecords = heddlePostgresSchema.table(
  'heartbeat_run_records',
  {
    namespace: text('namespace').notNull(),
    id: text('id').notNull(),
    taskId: text('task_id').notNull(),
    workspaceId: text('workspace_id'),
    executionId: text('execution_id').notNull(),
    runId: text('run_id'),
    createdAt: timestampColumn('created_at').notNull(),
    record: jsonb('record').$type<HeartbeatTaskRunRecord>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.namespace, table.id],
      name: 'heartbeat_run_records_pk',
    }),
    uniqueIndex('heartbeat_run_records_execution_idx').on(
      table.namespace,
      table.executionId,
    ),
    index('heartbeat_run_records_task_created_idx').on(
      table.namespace,
      table.taskId,
      table.createdAt,
    ),
  ],
);

export const heddlePostgresTables = {
  heartbeatTasks: postgresHeartbeatTasks,
  heartbeatRunRecords: postgresHeartbeatRunRecords,
};
