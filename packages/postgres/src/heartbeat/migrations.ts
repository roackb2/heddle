/** Bundled baseline SQL for hosts to adopt into their normal migration system. */
export const heartbeatPostgresMigrationSqlUrl = new URL(
  '../../migrations/heartbeat/0000_heartbeat_authority.sql',
  import.meta.url,
);
