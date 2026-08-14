# `@heddleagent/postgres`

Official PostgreSQL implementations for selected, public Heddle-owned durable
ports. Version `6.1.0` ships two independent adapter families:

| Entrypoint | Domain contract | Status |
| --- | --- | --- |
| `@heddleagent/postgres/heartbeat` | Heartbeat task-store and administration contracts from `@heddleagent/runtime/advanced` | Supported |
| `@heddleagent/postgres/execution-host/conversations` | `HostedConversationTurnLifecycleStore` from `@heddleagent/execution-host-client/conversation` | Supported |

There is no generic root storage provider. Conversation sessions, artifacts,
memory, telemetry, product history, and active execution are covered only when
an explicit entrypoint says so.

## Install

Install the adapter with its domain contract, Drizzle, and one supported
Drizzle PostgreSQL driver. Domain peers are optional at the package level so a
heartbeat consumer does not install the Execution Host client and vice versa.
For example, with `pg`:

```bash
npm install @heddleagent/postgres @heddleagent/execution-host-client drizzle-orm pg
```

For heartbeat task authority:

```bash
npm install @heddleagent/postgres @heddleagent/runtime drizzle-orm pg
```

## Heartbeat task authority

```ts
import {
  createPostgresHeartbeatTaskAuthority,
  heartbeatPostgresMigrationSqlUrl,
} from '@heddleagent/postgres/heartbeat';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const database = drizzle(pool);
const heartbeat = createPostgresHeartbeatTaskAuthority({
  database,
  namespace: authenticatedTenant.id,
  executionLeaseMs: 20 * 60_000,
});

void heartbeatPostgresMigrationSqlUrl;
```

The adapter owns row locking, due-task claims, execution fencing,
lease-backed recovery, checkpoints, run history, and atomic operator controls.
Workers receive `heartbeat.store`; trusted operator routes receive
`heartbeat.administration`. The adopter owns its pool, migration execution,
trusted namespace derivation, worker lifecycle, backups, and side-effect
idempotency.

## Execution Host conversation lifecycle

```ts
import { DurableHostedConversationTurnService } from
  '@heddleagent/execution-host-client/conversation';
import {
  createPostgresHostedConversationTurnLifecycleStore,
} from '@heddleagent/postgres/execution-host/conversations';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const database = drizzle(pool);
const store = createPostgresHostedConversationTurnLifecycleStore({ database });

const turns = new DurableHostedConversationTurnService({
  turns: executionHostTurnRunner,
  store,
});
```

The example omits application composition. The product authenticates callers,
derives tenant/subject/session scope on the server, owns its history queries
and retention, and closes the pool during application shutdown.

## Ownership

The domain package owns lifecycle validation, requested/accepted/terminal
ordering, safe terminal projection, expiry semantics, and the adapter-neutral
conformance suite. This package owns the concrete SQL table, atomic row
transitions, complete-scope fencing, database constraints, ordered migrations,
and real-PostgreSQL certification.

The adopter owns:

- its PostgreSQL service, credentials, pool lifecycle, backups, encryption,
  availability, monitoring, and disaster recovery;
- production migration execution through its normal migration system;
- authenticated scope derivation and database access policy;
- product tables, relationships, history queries, retention, billing, and UI;
  and
- reconciliation scheduling for expired open turns when its product promise
  requires crash convergence.

The adapter never starts a pool, runs migrations at runtime, accepts an
adopter-selected table name, or persists activity, tool inputs/results, hidden
reasoning, raw errors, credentials, assertions, traces, or workspace content.

## Migrations

Each entrypoint exports its ordered migration URL or URL list. The SQL files
ship under:

```text
migrations/execution-host/conversations/
migrations/heartbeat/
```

Adopt the relevant files into the application's reviewed migration process and
apply them before constructing an adapter. Runtime startup deliberately
performs no schema mutation. Each domain migration owns only its documented
`heddle` tables, constraints, and indexes.

### Copy the migration into your application

The adapter exports migration URLs so your build or release tooling can locate
the exact SQL shipped with the installed package:

```bash
node --input-type=module -e "import('@heddleagent/postgres/execution-host/conversations').then(({ executionHostConversationPostgresMigrationSqlUrls: urls }) => console.log(urls.map(String).join('\\n')))"
```

For a normal `node_modules` install, the current file is also available at:

```text
node_modules/@heddleagent/postgres/migrations/execution-host/conversations/0000_turn_lifecycle.sql
```

Copy every exported migration, in array order, into your application's own
checked-in migration directory. Rename the file only to fit the application's
sequence; do not rewrite the SQL. For example:

```bash
cp node_modules/@heddleagent/postgres/migrations/execution-host/conversations/0000_turn_lifecycle.sql \
  apps/server/drizzle/0005_execution_host_conversations.sql
```

Commit that copy and let the application's existing migration command apply it
before deploying code that constructs the store. This explicit adoption is
required because the application—not a library running at startup—owns schema
review, rollout order, rollback policy, and production database credentials.
When upgrading `@heddleagent/postgres`, compare the exported ordered list with
the migrations already adopted and copy only newly published files.

## Correctness promise

- `invocation_id` is globally unique, so a duplicate request cannot execute
  twice under another scope.
- Accepted and terminal writes lock the invocation row and fence by tenant,
  subject, and product-session scope.
- Exact repeats are idempotent; conflicting, wrong-scope, pre-acceptance, or
  late transitions fail atomically.
- Scoped expiry can interrupt only expired `requested` or `running` rows and
  cannot overwrite a terminal result.
- SQL constraints independently enforce identifier, status, failure-code,
  payload-size, acceptance, and terminal-shape invariants.
- The package runs the canonical lifecycle conformance suite against a real
  PostgreSQL service and independent pools.

This adapter makes the generic lifecycle durable. It does not turn that table
into a user-facing transcript or provide active-run replay/recovery.
