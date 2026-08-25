# `@heddleagent/postgres` 6.1.1

This patch makes the public heartbeat schema entrypoint resolvable by tools
such as Drizzle Kit without exposing the package's internal build layout.

## Changed

- `require.resolve('@heddleagent/postgres/heartbeat/schema')` now resolves the
  supported schema entrypoint.
- Drizzle consumers no longer need to locate `package.json` and append a
  `dist/heartbeat/schema.js` implementation path.

The heartbeat tables, task authority, SQL migrations, and runtime behavior are
unchanged.
