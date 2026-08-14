/** Real two-pool certification for the packaged PostgreSQL authority. */
import { randomUUID } from 'node:crypto';
import {
  HeartbeatTaskStateProjector,
  type HeartbeatTask,
  type HeartbeatTaskExecution,
  type HeartbeatTargetedTaskStore,
} from '@heddleagent/runtime/advanced';
import {
  HeartbeatTaskStoreConformance,
  type HeartbeatTaskStoreConformanceHarness,
} from '@heddleagent/runtime/heartbeat/testing';
import dayjs from 'dayjs';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createPostgresHeartbeatTaskAuthority } from './index.js';
import {
  postgresHeartbeatRunRecords as heartbeatRunRecords,
  postgresHeartbeatTasks as heartbeatTasks,
} from './schema.js';

const TEST_DATABASE_URL = process.env.HEDDLE_POSTGRES_TEST_URL;
const NOW = new Date('2026-08-11T00:00:00.000Z');
const TEST_EXECUTION_LEASE_MS = 60_000;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

type TestDatabase = {
  pool: Pool;
  orm: NodePgDatabase;
};

describePostgres('packaged PostgreSQL heartbeat authority', () => {
  const databasesByNamespace = new Map<string, TestDatabase[]>();
  const databaseByStore = new WeakMap<
    HeartbeatTargetedTaskStore,
    TestDatabase
  >();
  let schemaDatabase: TestDatabase | undefined;

  const harness: HeartbeatTaskStoreConformanceHarness = {
    createStore: (namespace) => {
      const database = createDatabase();
      const authority = createPostgresHeartbeatTaskAuthority({
        database: database.orm,
        namespace,
        executionLeaseMs: TEST_EXECUTION_LEASE_MS,
        now: () => NOW,
      });
      databasesByNamespace.set(namespace, [
        ...(databasesByNamespace.get(namespace) ?? []),
        database,
      ]);
      databaseByStore.set(authority.store, database);
      return authority.store;
    },
    cleanupNamespace: async (namespace) => {
      const databases = databasesByNamespace.get(namespace) ?? [];
      const [database] = databases;
      try {
        if (database) {
          await database.orm.delete(heartbeatRunRecords).where(
            eq(heartbeatRunRecords.namespace, namespace),
          );
          await database.orm.delete(heartbeatTasks).where(
            eq(heartbeatTasks.namespace, namespace),
          );
        }
      } finally {
        await Promise.all(databases.map(closeDatabase));
        databasesByNamespace.delete(namespace);
      }
    },
    now: () => NOW,
    makeExecutionRecoverable: async ({
      namespace,
      store,
      task,
      execution,
      recoverAt,
    }) => {
      const database = databaseByStore.get(store);
      if (!database) {
        throw new Error('Conformance store database was not registered.');
      }
      const runningTask = asRunningTask(task, execution);
      const updated = await database.orm
        .update(heartbeatTasks)
        .set({
          task: runningTask,
          enabled: runningTask.enabled,
          status: 'running',
          nextRunAt: runningTask.schedule.nextRunAt,
          executionId: execution.executionId,
          executionOwnerId: execution.ownerId,
          leaseExpiresAt: dayjs(recoverAt)
            .subtract(1, 'millisecond')
            .toISOString(),
          updatedAt: runningTask.state?.updatedAt ?? recoverAt.toISOString(),
        })
        .where(and(
          eq(heartbeatTasks.namespace, namespace),
          eq(heartbeatTasks.taskId, task.id),
        ))
        .returning({ taskId: heartbeatTasks.taskId });
      if (updated.length !== 1) {
        throw new Error(`Conformance task not found: ${task.id}`);
      }
    },
    capabilities: { runHistory: true },
  };

  beforeAll(async () => {
    schemaDatabase = createDatabase();
    const result = await schemaDatabase.orm.execute<{
      tasks: string | null;
      runs: string | null;
    }>(sql`select
      to_regclass('heddle.heartbeat_tasks')::text as tasks,
      to_regclass('heddle.heartbeat_run_records')::text as runs`);
    const [{ tasks, runs }] = result.rows;
    if (!tasks || !runs) {
      throw new Error(
        'Apply migrations/heartbeat/0000_heartbeat_authority.sql before running PostgreSQL certification.',
      );
    }
  });

  afterAll(async () => {
    await Promise.all(
      [...databasesByNamespace.keys()].map(async (namespace) => {
        await harness.cleanupNamespace(namespace);
      }),
    );
    if (schemaDatabase) {
      await closeDatabase(schemaDatabase);
    }
  });

  describe('Heddle targeted task-store conformance', () => {
    HeartbeatTaskStoreConformance.createScenarios(harness).forEach(
      (scenario) => {
        it(scenario.name, scenario.run, 30_000);
      },
    );
  });

  describe('atomic task administration', () => {
    let namespace: string;
    let first: ReturnType<typeof createPostgresHeartbeatTaskAuthority>;
    let second: ReturnType<typeof createPostgresHeartbeatTaskAuthority>;

    beforeEach(() => {
      namespace = `administration-${randomUUID()}`;
      first = createAuthority(namespace);
      second = createAuthority(namespace);
    });

    afterEach(async () => {
      await harness.cleanupNamespace(namespace);
    });

    it('serializes conflicting creation across independent pools', async () => {
      const input = {
        id: 'agent:conflict',
        task: 'Run exactly one agent cycle.',
        intervalMs: 60_000,
        defer: false,
      };
      const attempts = await Promise.allSettled([
        first.administration.createTask(input),
        second.administration.createTask(input),
      ]);

      expect(attempts.filter(({ status }) => status === 'fulfilled'))
        .toHaveLength(1);
      expect(attempts.filter(({ status }) => status === 'rejected'))
        .toHaveLength(1);
      await expect(first.administration.listTaskViews())
        .resolves.toHaveLength(1);
    });

    it('applies controls to the latest locked task row', async () => {
      const taskId = 'agent:controlled';
      await first.administration.createTask({
        id: taskId,
        task: 'Inspect pending work.',
        intervalMs: 60_000,
        defer: false,
      });

      await expect(second.administration.updateTask(taskId, {
        name: 'Controlled agent',
        intervalMs: 120_000,
      })).resolves.toMatchObject({
        name: 'Controlled agent',
        schedule: { intervalMs: 120_000 },
      });
      await expect(first.administration.setTaskEnabled(taskId, false))
        .resolves.toMatchObject({ enabled: false });
      await expect(second.administration.setTaskEnabled(taskId, true))
        .resolves.toMatchObject({ enabled: true });
      await expect(first.administration.triggerTaskRun(taskId))
        .resolves.toMatchObject({
          state: { runRequest: { pending: true } },
        });
    });

    it('rejects deletion while claimed and removes settled history', async () => {
      const taskId = 'agent:deletion';
      await first.administration.createTask({
        id: taskId,
        task: 'Create one inspectable history entry.',
        defer: false,
      });
      const execution = createExecution('deletion');
      await second.store.claimTaskExecution({
        taskId,
        execution,
        loadedCheckpoint: false,
        claimedAt: new Date(execution.claimedAt),
        claimMode: 'due',
      });

      await expect(first.administration.deleteTask(taskId))
        .rejects.toThrow('is running');
      await second.store.recordTaskExecutionOutcome({
        taskId,
        execution,
        kind: 'skipped',
        summary: 'History persisted before deletion.',
        finishedAt: NOW,
      });
      await expect(first.administration.readTask(taskId))
        .resolves.toMatchObject({ runs: [{ taskId }] });
      await first.administration.deleteTask(taskId);
      await expect(second.store.loadTask(taskId)).resolves.toBeUndefined();
      await expect(second.store.listRunRecords?.({ taskId }))
        .resolves.toEqual([]);
    });

    it('preserves operator updates across a concurrent claim', async () => {
      const taskId = 'agent:update-claim-race';
      await first.administration.createTask({
        id: taskId,
        task: 'Race one claim with one operator update.',
        intervalMs: 60_000,
        defer: false,
      });
      const execution = createExecution('update-claim-race');

      const [updated, claimed] = await Promise.all([
        first.administration.updateTask(taskId, {
          name: 'Updated without losing claim',
        }),
        second.store.claimTaskExecution({
          taskId,
          execution,
          loadedCheckpoint: false,
          claimedAt: new Date(execution.claimedAt),
          claimMode: 'any',
        }),
      ]);

      expect(updated.name).toBe('Updated without losing claim');
      expect(claimed.status).toBe('claimed');
      await expect(first.store.loadTask(taskId)).resolves.toMatchObject({
        name: 'Updated without losing claim',
        state: {
          status: 'running',
          execution: { executionId: execution.executionId },
        },
      });
    });
  });

  function createAuthority(namespace: string) {
    const database = createDatabase();
    const authority = createPostgresHeartbeatTaskAuthority({
      database: database.orm,
      namespace,
      executionLeaseMs: TEST_EXECUTION_LEASE_MS,
      now: () => NOW,
    });
    databasesByNamespace.set(namespace, [
      ...(databasesByNamespace.get(namespace) ?? []),
      database,
    ]);
    databaseByStore.set(authority.store, database);
    return authority;
  }

  function createDatabase(): TestDatabase {
    const pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 2,
      application_name: 'heddle-postgres-certification',
    });
    return { pool, orm: drizzle(pool) };
  }
});

function asRunningTask(
  task: HeartbeatTask,
  execution: HeartbeatTaskExecution,
): HeartbeatTask {
  return HeartbeatTaskStateProjector.markRunning({
    task,
    execution,
    loadedCheckpoint: false,
    now: new Date(execution.claimedAt),
  });
}

function createExecution(label: string): HeartbeatTaskExecution {
  return {
    executionId: `${label}-${randomUUID()}`,
    ownerId: `owner-${randomUUID()}`,
    claimedAt: NOW.toISOString(),
  };
}

async function closeDatabase(database: TestDatabase): Promise<void> {
  await database.pool.end();
}
