import {
  drizzle,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createPostgresHeartbeatTaskAuthority } from './index.js';
import type { HeartbeatPostgresDatabase } from './types.js';

describe('PostgreSQL heartbeat authority configuration', () => {
  const database = drizzle.mock();

  it('accepts standard Drizzle PostgreSQL driver databases', () => {
    expectTypeOf<NodePgDatabase>()
      .toMatchTypeOf<HeartbeatPostgresDatabase>();
    expectTypeOf<PostgresJsDatabase>()
      .toMatchTypeOf<HeartbeatPostgresDatabase>();
  });

  it('creates frozen least-privilege ports', () => {
    const authority = createPostgresHeartbeatTaskAuthority({
      database,
      namespace: 'tenant-a',
      executionLeaseMs: 60_000,
    });

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.store)).toBe(true);
    expect(Object.isFrozen(authority.administration)).toBe(true);
    expect(authority.store).not.toHaveProperty('createTask');
    expect(authority.administration).not.toHaveProperty('claimTaskExecution');
  });

  it.each([
    ['', 60_000, 'namespace'],
    ['   ', 60_000, 'namespace'],
    ['valid', 0, 'positive safe integer'],
    ['valid', -1, 'positive safe integer'],
    ['valid', Number.MAX_SAFE_INTEGER + 1, 'positive safe integer'],
  ] as const)(
    'rejects invalid namespace and lease configuration',
    (namespace, executionLeaseMs, message) => {
      expect(() => createPostgresHeartbeatTaskAuthority({
        database,
        namespace,
        executionLeaseMs,
      })).toThrow(message);
    },
  );
});
