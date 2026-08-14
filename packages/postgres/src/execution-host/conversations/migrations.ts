/** Ordered SQL migrations for adopter-controlled production migration runs. */
export const executionHostConversationPostgresMigrationSqlUrls = Object.freeze([
  new URL(
    '../../../migrations/execution-host/conversations/0000_turn_lifecycle.sql',
    import.meta.url,
  ),
]);
