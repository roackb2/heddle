import { createPostgresHeartbeatTaskAdministration } from './administration.js';
import { HeartbeatPostgresContext } from './internal/context.js';
import { createPostgresHeartbeatTaskStore } from './store.js';
import type {
  PostgresHeartbeatTaskAuthority,
  PostgresHeartbeatTaskAuthorityOptions,
} from './types.js';

/**
 * Creates paired worker and administration ports over one PostgreSQL namespace.
 *
 * The split prevents execution workers from receiving operator controls while
 * both ports still share the same row-locking and fencing implementation.
 */
export function createPostgresHeartbeatTaskAuthority(
  options: PostgresHeartbeatTaskAuthorityOptions,
): PostgresHeartbeatTaskAuthority {
  const context = new HeartbeatPostgresContext(options);
  const store = createPostgresHeartbeatTaskStore(context);
  const administration = createPostgresHeartbeatTaskAdministration(
    context,
    store,
  );
  return Object.freeze({ store, administration });
}

export { heartbeatPostgresMigrationSqlUrl } from './migrations.js';
export {
  heddlePostgresSchema,
  heddlePostgresTables,
  postgresHeartbeatRunRecords,
  postgresHeartbeatTasks,
} from './schema.js';
export type {
  HeartbeatPostgresDatabase,
  PostgresHeartbeatTaskAuthority,
  PostgresHeartbeatTaskAuthorityOptions,
} from './types.js';
