# PostgreSQL + Drizzle conversation storage

This runnable SDK reference shows how a TypeScript host can persist Heddle's
complete conversation sessions and compacted archives in PostgreSQL. It uses
`drizzle-orm` with the mature `pg` driver, Heddle's public repository contracts,
and the public session conformance suite.

This is host-owned reference code, not an official Heddle database adapter.
Copy and adapt it inside the service that already owns authentication,
PostgreSQL, migrations, connection pooling, and operations.

## What it proves

- complete opaque `ChatSession` JSONB records survive a new connection pool and
  newly constructed conversation engine;
- create uniqueness and expected-revision update/delete are atomic in SQL;
- catalog pages use Heddle's pinned/updated/id order with PostgreSQL `C`
  collation for the final ID tie-breaker;
- every query is bound to a trusted server-side scope;
- immutable archive messages, rolling summary, and the next manifest commit in
  one transaction; and
- another trusted scope can reuse the same session/archive IDs without reading
  or mutating the first scope's records.

The verification makes no model request and requires no API key.

## Run it

From the Heddle repository root:

```bash
docker compose \
  -f examples/sdk/06-persistence/postgres-drizzle/compose.yaml \
  up -d --wait

yarn example:postgres-storage:migrate
yarn example:postgres-storage:verify
```

The default connection is intentionally limited to the local Compose service:

```text
postgresql://heddle:heddle@127.0.0.1:54329/heddle_reference
```

To use another development database, set the server-only variable explicitly:

```bash
HEDDLE_POSTGRES_DATABASE_URL='postgresql://user:password@host/database' \
  yarn example:postgres-storage:verify
```

Stop and remove the local database and its named volume when finished:

```bash
docker compose \
  -f examples/sdk/06-persistence/postgres-drizzle/compose.yaml \
  down -v
```

## Read the implementation

```text
06-persistence/postgres-drizzle/
  schema.ts                              Drizzle tables and indexes
  drizzle/                               checked-in SQL migration + metadata
  postgres-chat-session-repository.ts    revisions, CAS, filters, pagination
  postgres-chat-archive-repository.ts    locked manifest + atomic archive append
  migration.ts                           host-callable migration boundary
  migrate.ts                             standalone migration command
  verify.ts                              conformance + fresh-service recovery
  compose.yaml                           isolated local PostgreSQL 17 service
```

[`schema.ts`](schema.ts) is the readable TypeScript schema. The generated SQL
migration is the deployment artifact; review both whenever the schema changes:

```bash
yarn drizzle-kit generate \
  --config examples/sdk/06-persistence/postgres-drizzle/drizzle.config.ts
```

## Compose the repositories

In an application, construct both repositories from the same authenticated
server-side scope and inject them together:

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { createConversationEngine } from '@roackb2/heddle'
import { PostgresChatArchiveRepository } from './postgres-chat-archive-repository.js'
import { PostgresChatSessionRepository } from './postgres-chat-session-repository.js'
import { postgresStorageSchema } from './schema.js'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const database = drizzle({ client: pool, schema: postgresStorageSchema })

// Derive this once from verified server authentication. Never trust a scope id
// supplied by the browser or by an unverified request body.
const scopeId = authenticatedAccount.id
const sessionRepository = new PostgresChatSessionRepository({ database, scopeId })
const archiveRepository = new PostgresChatArchiveRepository({ database, scopeId })

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model,
  persistence: {
    conversations: {
      sessions: sessionRepository,
      archives: archiveRepository,
    },
  },
})
```

`engine.persistence.conversations.readiness` confirms that the complete Heddle
conversation boundary is configured and lists the remaining host-owned checks.
It does not certify this scope, database, migrations, backup, or deployment;
the verification script below exercises the provider-specific invariants.

When copying these files into another project, replace the relative imports
from `../../../../src/index.js` with `@roackb2/heddle` and declare the dependencies
your host imports directly:

```bash
yarn add @roackb2/heddle drizzle-orm pg
yarn add --dev drizzle-kit @types/pg tsx
```

## Storage and consistency boundary

`heddle_chat_sessions` stores the complete Heddle record in `session` JSONB and
duplicates only indexed catalog fields. `revision` is compared and incremented
inside the same `UPDATE`; the adapter never performs a read-modify-write race in
application memory. Cursor predicates and ordering use the same composite
`pinned DESC, updated_at DESC, id COLLATE "C" ASC` order.

Archives intentionally use separate tables:

- `heddle_chat_session_archives` contains immutable archive records, exact
  messages, and summaries;
- `heddle_chat_session_archive_heads` contains the current manifest for one
  scoped session.

`append` creates or locks the head with `SELECT ... FOR UPDATE`, validates the
stored manifest through `ChatArchivePersistenceCodec`, inserts immutable
content, and advances the head in one transaction. A rollback cannot expose a
manifest that references missing database content.

Deleting a session does not automatically delete archives in this reference.
Retention and legal/audit requirements differ between hosts; define that
lifecycle explicitly in the host instead of hiding it in a foreign-key cascade.

## Production responsibilities

Before adapting this example for production, the host still needs to own:

- migration rollout/rollback and compatibility across mixed application
  versions;
- TLS, secret rotation, pool sizing, statement/lock timeouts, retry policy, and
  graceful pool shutdown;
- authenticated scope derivation and optional PostgreSQL RLS as defense in
  depth;
- query-plan/load testing, metrics, slow-query and lock observability;
- transcript size limits or an object-store design for large immutable content;
- retention, orphan cleanup, backup/restore drills, and disaster recovery; and
- process routing for active runs and SSE plus durability for artifacts, traces,
  memory, and any product-visible transcript.

Passing Heddle's conformance suite certifies the exercised repository contract;
it does not certify those operational concerns. Keep this reference in host
code until at least two independent hosts validate the same configuration and
migration surface. Only then consider extracting an optional maintained adapter
package.
