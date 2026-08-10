import type {
  HeartbeatTargetedTaskStore,
  HeartbeatTaskAdministrationService,
} from '@roackb2/heddle/advanced';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';

/** Any Drizzle PostgreSQL driver with the standard PgDatabase query surface. */
export type HeartbeatPostgresDatabase = PgDatabase<PgQueryResultHKT>;

export type PostgresHeartbeatTaskAuthorityOptions = {
  database: HeartbeatPostgresDatabase;
  /** Isolates one service, tenant, or test fixture inside the shared schema. */
  namespace: string;
  /** Must exceed the maximum bounded worker-attempt duration. */
  executionLeaseMs: number;
  now?: () => Date;
  createRunRecordId?: () => string;
};

export type PostgresHeartbeatTaskAuthority = Readonly<{
  store: HeartbeatTargetedTaskStore;
  administration: HeartbeatTaskAdministrationService;
}>;
