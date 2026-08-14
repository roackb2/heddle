import { randomUUID } from 'node:crypto';
import {
  HostedConversationTurnStoreConformance,
} from '@heddleagent/execution-host-client/testing';
import type {
  HostedConversationAcceptedTurn,
  HostedConversationRequestedTurn,
  HostedConversationTurnIdentity,
  HostedConversationTurnLifecycleRecord,
  HostedConversationTurnSettlement,
} from '@heddleagent/execution-host-client/conversation';
import dayjs from 'dayjs';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createPostgresHostedConversationTurnLifecycleStore,
} from './store.js';
import {
  postgresExecutionHostConversationTurns as turns,
} from './schema.js';

const TEST_DATABASE_URL = process.env.HEDDLE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;
const scope = Object.freeze({
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  productSessionId: 'session-a',
});

type TestDatabase = {
  pool: Pool;
  orm: NodePgDatabase;
};

describePostgres('PostgreSQL Execution Host conversation lifecycle', () => {
  let first: TestDatabase;
  let second: TestDatabase;

  beforeAll(async () => {
    first = createDatabase('heddle-postgres-lifecycle-first');
    second = createDatabase('heddle-postgres-lifecycle-second');
    const result = await first.orm.execute<{ table_name: string | null }>(
      sql`select to_regclass(
        'heddle.execution_host_conversation_turns'
      )::text as table_name`,
    );
    if (!result.rows[0]?.table_name) {
      throw new Error(
        'Apply migrations/execution-host/conversations/0000_turn_lifecycle.sql before PostgreSQL certification.',
      );
    }
  });

  beforeEach(clearTurns);

  afterAll(async () => {
    await clearTurns();
    await Promise.all([first.pool.end(), second.pool.end()]);
  });

  it('passes the canonical lifecycle and fencing conformance', async () => {
    const store = createPostgresHostedConversationTurnLifecycleStore({
      database: first.orm,
    });
    await HostedConversationTurnStoreConformance.verify({
      store,
      findTurn,
      clear: clearTurns,
    });
  });

  it('serializes conflicting acceptance across independent pools', async () => {
    const requested = requestedTurn('acceptance-race');
    const firstStore = createStore(first.orm);
    const secondStore = createStore(second.orm);
    await firstStore.createTurn(requested);

    const acceptedAt = '2026-08-14T06:00:01.000Z';
    const attempts = await Promise.allSettled([
      firstStore.recordAccepted({
        invocationId: requested.invocationId,
        scope,
        runId: 'run-first',
        acceptedAt,
      }),
      secondStore.recordAccepted({
        invocationId: requested.invocationId,
        scope,
        runId: 'run-second',
        acceptedAt,
      }),
    ]);

    expect(attempts.filter(({ status }) => status === 'fulfilled'))
      .toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected'))
      .toHaveLength(1);
    await expect(findTurn(requested)).resolves.toMatchObject({
      status: 'running',
      acceptedAt,
    });
  });

  it('never lets expiry overwrite a concurrent terminal settlement', async () => {
    const requested = requestedTurn('expiry-race', {
      deadlineAt: '2026-08-14T05:59:00.000Z',
    });
    const accepted: HostedConversationAcceptedTurn = {
      invocationId: requested.invocationId,
      scope,
      runId: 'run-expiry-race',
      acceptedAt: '2026-08-14T06:00:01.000Z',
    };
    const completed: HostedConversationTurnSettlement = {
      invocationId: requested.invocationId,
      scope,
      status: 'completed',
      summary: 'The terminal result remains authoritative.',
      settledAt: '2026-08-14T06:00:02.000Z',
    };
    const firstStore = createStore(first.orm);
    const secondStore = createStore(second.orm);
    await firstStore.createTurn(requested);
    await firstStore.recordAccepted(accepted);

    await Promise.allSettled([
      firstStore.settleTurn(completed),
      secondStore.interruptExpiredTurns({
        scope,
        expiredBefore: '2026-08-14T06:00:00.000Z',
        settledAt: '2026-08-14T06:00:03.000Z',
      }),
    ]);

    const settled = await findTurn(requested);
    expect(['completed', 'interrupted']).toContain(settled?.status);
    await secondStore.interruptExpiredTurns({
      scope,
      expiredBefore: '2026-08-14T06:00:04.000Z',
      settledAt: '2026-08-14T06:00:05.000Z',
    });
    await expect(findTurn(requested)).resolves.toEqual(settled);
    if (settled?.status === 'interrupted') {
      await expect(firstStore.settleTurn(completed)).rejects.toThrow(
        'cannot transition',
      );
    }
  });

  it('survives replacement of the pool that created the request', async () => {
    const temporary = createDatabase('heddle-postgres-lifecycle-temporary');
    const requested = requestedTurn('pool-replacement');
    await createStore(temporary.orm).createTurn(requested);
    await temporary.pool.end();

    await expect(findTurn(requested)).resolves.toEqual({
      ...requested,
      status: 'requested',
    });
  });

  it('lets database constraints reject an impossible terminal shape', async () => {
    const requested = requestedTurn('constraint-shape');
    await createStore(first.orm).createTurn(requested);

    await expect(first.orm.execute(sql`
      update ${turns}
      set status = 'failed',
          failure_code = 'deadline_elapsed',
          settled_at = now()
      where invocation_id = ${requested.invocationId}
    `)).rejects.toThrow();
    await expect(first.orm.execute(sql`
      update ${turns}
      set status = 'completed', settled_at = now()
      where invocation_id = ${requested.invocationId}
    `)).rejects.toThrow();
    await expect(findTurn(requested)).resolves.toMatchObject({
      status: 'requested',
    });
  });

  it('stores only the bounded lifecycle projection columns', async () => {
    const result = await first.orm.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'heddle'
        and table_name = 'execution_host_conversation_turns'
      order by ordinal_position
    `);

    expect(result.rows.map(({ column_name }) => column_name)).toEqual([
      'invocation_id',
      'tenant_id',
      'subject_id',
      'product_session_id',
      'prompt',
      'deadline_at',
      'status',
      'run_id',
      'summary',
      'failure_code',
      'requested_at',
      'accepted_at',
      'settled_at',
    ]);
  });

  function createStore(database: NodePgDatabase) {
    return createPostgresHostedConversationTurnLifecycleStore({ database });
  }

  async function findTurn(
    identity: HostedConversationTurnIdentity,
  ): Promise<HostedConversationTurnLifecycleRecord | undefined> {
    const [row] = await second.orm
      .select()
      .from(turns)
      .where(and(
        eq(turns.invocationId, identity.invocationId),
        eq(turns.tenantId, identity.scope.tenantId),
        eq(turns.subjectId, identity.scope.subjectId),
        eq(turns.productSessionId, identity.scope.productSessionId),
      ))
      .limit(1);
    return row ? recordFromRow(row) : undefined;
  }

  async function clearTurns(): Promise<void> {
    if (first) {
      await first.orm.delete(turns);
    }
  }
});

function requestedTurn(
  label: string,
  options: { deadlineAt?: string } = {},
): HostedConversationRequestedTurn {
  return {
    invocationId: `${label}-${randomUUID()}`,
    scope,
    prompt: `Run the ${label} certification case.`,
    ...(options.deadlineAt ? { deadlineAt: options.deadlineAt } : {}),
    requestedAt: '2026-08-14T06:00:00.000Z',
  };
}

function recordFromRow(
  row: typeof turns.$inferSelect,
): HostedConversationTurnLifecycleRecord {
  return {
    invocationId: row.invocationId,
    scope: {
      tenantId: row.tenantId,
      subjectId: row.subjectId,
      productSessionId: row.productSessionId,
    },
    prompt: row.prompt,
    ...(row.deadlineAt
      ? { deadlineAt: normalizeReadTimestamp(row.deadlineAt) }
      : {}),
    requestedAt: normalizeReadTimestamp(row.requestedAt),
    status: row.status,
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.summary !== null ? { summary: row.summary } : {}),
    ...(row.failureCode !== null ? { failureCode: row.failureCode } : {}),
    ...(row.acceptedAt
      ? { acceptedAt: normalizeReadTimestamp(row.acceptedAt) }
      : {}),
    ...(row.settledAt
      ? { settledAt: normalizeReadTimestamp(row.settledAt) }
      : {}),
  };
}

function normalizeReadTimestamp(value: string): string {
  return dayjs(value).toISOString();
}

function createDatabase(applicationName: string): TestDatabase {
  const pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 2,
    application_name: applicationName,
  });
  return { pool, orm: drizzle(pool) };
}
