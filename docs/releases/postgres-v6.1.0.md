# `@heddleagent/postgres` 6.1.0

This release consolidates the existing PostgreSQL heartbeat authority into the
v6 adapter family without changing its task, claim, lease, checkpoint, history,
or administration behavior.

## Added

- `@heddleagent/postgres/heartbeat`
- `@heddleagent/postgres/heartbeat/schema`
- the ordered `migrations/heartbeat/0000_heartbeat_authority.sql` migration

The existing Execution Host lifecycle entrypoint remains unchanged at
`@heddleagent/postgres/execution-host/conversations`.

Heartbeat consumers install the runtime contract alongside the adapter:

```bash
npm install @heddleagent/postgres @heddleagent/runtime drizzle-orm pg
```

The former `@roackb2/heddle-postgres@5.13.0` tarball remains installable for
existing consumers. Its local source package has been removed so the repository
has one canonical PostgreSQL adapter family.
