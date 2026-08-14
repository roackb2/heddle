import type {
  HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import type { PgDatabase } from 'drizzle-orm/pg-core/db';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core/session';

/** Any adopter-managed Drizzle PostgreSQL database handle. */
export type ExecutionHostConversationPostgresDatabase =
  PgDatabase<PgQueryResultHKT>;

export type PostgresHostedConversationTurnLifecycleStoreOptions = {
  database: ExecutionHostConversationPostgresDatabase;
};

export type PostgresHostedConversationTurnLifecycleStore =
  HostedConversationTurnLifecycleStore;
