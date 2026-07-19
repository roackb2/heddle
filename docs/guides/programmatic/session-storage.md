# Durable Session Storage

Heddle owns conversation-session semantics: messages, turns, leases, queued
prompts, compaction metadata, and optimistic mutation coordination. A host owns
where those records live and how an authenticated product user is scoped to
them. Compacted raw transcripts and rolling summaries use a separate
`ChatArchiveRepository` because their append-only lifecycle is different from
revisioned active-session records.

Use the default JSON adapters for one-machine/local-first products. For hosted
or multi-process products, inject both repositories through the
`persistence.conversations` capability so the completed-conversation boundary
cannot be mistaken for a session-only configuration.

For the exact boundary between local durability, completed-conversation
durability, and durable in-flight execution, see the
[durability support matrix](durability-support.md).

## Local JSON: zero configuration

`createConversationEngine` uses `FileChatSessionRepository` by default. Point
`stateRoot` at a durable application-data directory and Heddle creates the
catalog and immutable revision files beneath it:

```ts
import { createConversationEngine } from '@roackb2/heddle'

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot: '/var/lib/my-agent',
  model: 'gpt-5.4',
})
```

To choose the catalog location explicitly:

```ts
import { join } from 'node:path'
import { createConversationEngine } from '@roackb2/heddle'

const sessionStoragePath = join(dataDir, 'agent-sessions.catalog.json')
const engine = createConversationEngine({
  workspaceRoot,
  stateRoot: dataDir,
  model: 'gpt-5.4',
  sessionStoragePath,
})
```

The separate `sessionRepository` and `archiveRepository` options remain for
compatibility. New hosted integrations should use the complete conversation
capability shown below.

The file adapter serializes writers across processes and uses immutable session
bodies plus atomic catalog replacement. Keep the directory on a filesystem
with normal local rename/locking semantics; do not put it on an eventually
consistent object-store mount.

The runnable [local JSON storage example](../../../examples/sdk/06-local-json-storage/README.md)
proves fresh-engine recovery and a stopped-writer backup/restore without a
model credential. In production, mount the complete `stateRoot` on persistent
storage, stop writers or take one atomic filesystem snapshot, and back up and
restore the whole directory. Copying only the catalog or only archive files can
produce an incomplete conversation. This posture is for one durable host; use
paired remote repositories when requests can land on different replicas.

## Hosted database: inject the async port

The repository contract is record-oriented. It does not ask a database adapter
to load and rewrite the entire session collection:

```ts
import {
  createConversationEngine,
  type ChatSessionRepository,
} from '@roackb2/heddle'

const sessionRepository: ChatSessionRepository = {
  list: async (input) => listSessionPage(input),
  read: async (sessionId) => readSessionRecord(sessionId),
  create: async (session) => createSessionRecord(session),
  update: async (input) => compareAndSwapSession(input),
  delete: async (input) => compareAndSwapSessionDelete(input),
}
```

For a hosted service, session storage alone is not complete durability. Build
the companion archive repository from the same trusted server-side identity
scope, then inject the pair as one capability:

```ts
import {
  ChatArchivePersistenceCodec,
  createConversationEngine,
  type ChatArchiveRepository,
} from '@roackb2/heddle'

const archiveRepository: ChatArchiveRepository = {
  loadManifest: async (sessionId) => {
    const stored = await readArchiveManifest(sessionId)
    return stored
      ? ChatArchivePersistenceCodec.parseManifest(stored, sessionId)
      : ChatArchivePersistenceCodec.emptyManifest(sessionId)
  },
  readSummary: async (summaryLocator) => readArchiveSummary(summaryLocator),
  append: async (input) => database.transaction(async (tx) => {
    const currentValue = await tx.readArchiveManifestForUpdate(input.sessionId)
    const current = currentValue
      ? ChatArchivePersistenceCodec.parseManifest(currentValue, input.sessionId)
      : ChatArchivePersistenceCodec.emptyManifest(input.sessionId)
    const archive = {
      ...input.archive,
      path: `db://conversation-archives/${input.archive.id}/messages`,
      summaryPath: `db://conversation-archives/${input.archive.id}/summary`,
    }
    const manifest = ChatArchivePersistenceCodec.appendArchive(current, archive)

    await tx.insertArchive({
      sessionId: input.sessionId,
      archive,
      messages: input.messages,
      summary: input.summary,
    })
    await tx.writeArchiveManifest(input.sessionId, manifest)
    return { archive, manifest }
  }),
}

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: 'gpt-5.4',
  persistence: {
    conversations: {
      sessions: sessionRepository,
      archives: archiveRepository,
    },
  },
})
```

The engine exposes the resolved repositories and a non-certifying readiness
report at `engine.persistence.conversations`. To inspect a configuration before
constructing the engine:

```ts
import { ConversationPersistenceService } from '@roackb2/heddle'

const readiness = ConversationPersistenceService.assess({
  persistence: {
    conversations: {
      sessions: sessionRepository,
      archives: archiveRepository,
    },
  },
})

if (!readiness.configurationComplete) {
  throw new Error(readiness.issues.map((issue) => issue.message).join('\n'))
}

for (const check of readiness.requiredHostChecks) {
  console.log(`${check.id}: ${check.description}`)
}
```

This report confirms configuration shape and identifies the focused host checks
needed for the selected durability level. It does not query the database or
certify auth/RLS, scope binding, migrations, backup, load, or disaster
recovery. Keep those checks in the host or maintained adapter.

`append` is the durability boundary: the exact messages, rolling summary, and
returned manifest must become visible in one transaction. If it rejects,
Heddle keeps the exact active transcript and does not persist compacted session
state that points at incomplete content. The legacy `path` and `summaryPath`
field names are repository-owned opaque locators; only the default file adapter
promises filesystem paths.

### Reuse Heddle's adapter-authoring primitives

Remote adapters should not maintain a second validator or invent a cursor wire
format. Heddle exports the database-neutral parts of the contract:

```ts
import {
  ChatSessionCatalogPagination,
  ChatSessionPersistenceCodec,
} from '@roackb2/heddle'

// Fail loudly if JSON/JSONB cannot reconstruct one complete Heddle session.
const session = ChatSessionPersistenceCodec.parseRecord(row.session)

// Reuse the canonical browser-safe/indexed projection on create and update.
const catalog = ChatSessionPersistenceCodec.projectCatalogEntry(
  session,
  Number(row.revision),
)

ChatSessionCatalogPagination.validatePageLimit(input.limit)
const cursor = input.cursor
  ? ChatSessionCatalogPagination.decodeCursor(input.cursor)
  : undefined

// After a query returns limit + 1 rows, encode the last included row.
const nextCursor = hasNextPage && lastIncluded
  ? ChatSessionCatalogPagination.encodeCursor(lastIncluded)
  : undefined
```

`decodeCursor(...)` supplies `(pinned, updatedAt, id)` for the database
predicate shown below. Express that predicate and order in SQL; do not fetch an
entire tenant catalog merely to call the in-process comparator. Translate
database constraint/CAS failures to Heddle's exported repository errors, and
wrap record-validation failures only to add row/storage context—never continue
with a partial session.

Construct the adapter with trusted server-side identity/scope. Do not accept a
tenant or account ID from the browser and then trust it inside repository
methods. Heddle deliberately leaves product account IDs and row-level-security
fields out of `ChatSession`.

## PostgreSQL shape

Use the product's existing PostgreSQL driver or ORM. A practical table stores
the complete Heddle record as JSONB and duplicates only the catalog fields that
need indexes:

```sql
create table agent_sessions (
  tenant_id uuid not null,
  id text not null,
  revision bigint not null check (revision > 0),
  session jsonb not null,
  workspace_id text,
  pinned boolean not null,
  archived_at timestamptz,
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);

create index agent_sessions_catalog_idx
  on agent_sessions (
    tenant_id,
    pinned desc,
    updated_at desc,
    (id collate "C") asc
  );
```

`create` inserts revision `1` and translates a unique-key violation to
`ChatSessionAlreadyExistsError`.

`update` must compare and increment the revision atomically:

```sql
update agent_sessions
set session = $3,
    revision = revision + 1,
    workspace_id = $4,
    pinned = $5,
    archived_at = $6,
    updated_at = $7
where tenant_id = $1
  and id = $2
  and revision = $8
returning session, revision;
```

If no row is returned, query the current revision in the same transaction. A
missing row maps to `undefined`; a present row maps to
`ChatSessionRevisionConflictError`. `delete` follows the same expected-revision
rule. Do not silently overwrite or delete the newer record.

Catalog pages use this order:

```sql
order by pinned desc, updated_at desc, id collate "C" asc
```

Encode the last row's `(pinned, updated_at, id)` as an opaque cursor. The next
page predicate must use the identical order:

```sql
where (
  pinned < $cursor_pinned
  or (pinned = $cursor_pinned and updated_at < $cursor_updated_at)
  or (
    pinned = $cursor_pinned
    and updated_at = $cursor_updated_at
    and id collate "C" > $cursor_id
  )
)
```

Apply tenant, workspace, and archive filters before the cursor predicate.

### PostgreSQL archive shape

Keep archive content separate from the hot session row. One practical JSONB
shape uses an immutable content row plus one locked manifest/head row:

```sql
create table agent_conversation_archives (
  tenant_id uuid not null,
  session_id text not null,
  archive_id text not null,
  archive_record jsonb not null,
  messages jsonb not null,
  summary text not null,
  created_at timestamptz not null,
  primary key (tenant_id, session_id, archive_id)
);

create table agent_conversation_archive_heads (
  tenant_id uuid not null,
  session_id text not null,
  manifest jsonb not null,
  updated_at timestamptz not null,
  primary key (tenant_id, session_id)
);
```

In `append`, create or lock the head row with `SELECT ... FOR UPDATE`, validate
its JSONB with `ChatArchivePersistenceCodec.parseManifest`, insert the immutable
archive row, and update the head in the same transaction. Enforce the composite
tenant/session key in every query. A Drizzle adapter can map the JSONB columns
to TypeScript shapes, but it must still run the Heddle codec when data crosses
the storage boundary; TypeScript generics do not validate stored JSON.

For large transcripts, replace `messages jsonb` with an object-store key. Write
the immutable object before committing the manifest transaction. A failed
transaction may leave an unreferenced object for a retention job to remove, but
the committed manifest must never reference a missing object.

### Runnable PostgreSQL + Drizzle reference

The repository includes a complete
[PostgreSQL + Drizzle example](../../../examples/sdk/06-postgres-drizzle-storage/README.md)
with checked-in migrations, scope-bound session and archive repositories, the
public session conformance suite, concurrent archive verification, and recovery
through fresh connection pools and engine instances. Drizzle and `pg` are
example-only development dependencies; they are not Heddle runtime dependencies
or exported adapters.

Use that directory as a host implementation reference, then move the adapted
files and migration ownership into your service. Do not import the example as a
supported package or bypass your host's existing authentication, pool, and
migration lifecycle.

## Required behavior

Before using a custom adapter in production, run Heddle's reusable conformance
suite in the adapter's own integration-test environment:

```ts
import { test } from 'node:test'
import {
  ChatSessionRepositoryConformance,
  type ChatSessionRepositoryConformanceHarness,
} from '@roackb2/heddle'

const harness: ChatSessionRepositoryConformanceHarness = {
  // Each call must return a new instance, already bound to this server-side
  // test tenant/scope. Never trust a browser-supplied tenant identifier here.
  createRepository: (scopeId) => createPostgresSessionRepository({ scopeId }),
  cleanupScope: (scopeId) => deletePostgresTestScope(scopeId),
  // Test infrastructure should damage the stored JSON/JSONB without deleting
  // the row, so read(sessionId) still finds and rejects the addressable record.
  corruptSessionRecord: ({ scopeId, sessionId }) =>
    corruptPostgresSessionRecord({ scopeId, sessionId }),
}

for (const scenario of ChatSessionRepositoryConformance.createScenarios(harness)) {
  test(scenario.name, scenario.run)
}
```

The suite generates opaque UUID-shaped scopes, creates fresh repository
instances when testing races and reopen behavior, and cleans every scope even
when a scenario fails. It verifies:

- two writers updating the same revision cannot lose one another's changes;
- the adapter distinguishes missing, already-existing, and conflicting rows;
- cursor pages neither skip nor repeat rows when timestamps tie;
- archived/workspace filters are enforced within the authorized scope;
- a second engine/process can reopen a session and continue its messages,
  turns, queue, lease, and compaction state;
- storage errors reach the host as failures rather than being reported as a
  successful turn.

Passing the suite does not certify authentication/RLS, schema migrations,
query plans, pooling, load, process-kill recovery, backups, or disaster
recovery. Keep those checks in the host service. `runAll(harness)` is available
for a sequential smoke script, but registering the named callbacks with the
host's normal integration-test runner produces better diagnostics.

See the repository's local
[`README.md`](../../../src/core/chat/engine/sessions/repository/README.md) for
the exact session adapter boundary and file-layout details. The archive port's
separate ownership and atomicity rules are in its
[`README.md`](../../../src/core/chat/engine/sessions/archives/README.md).

The session conformance suite does not certify a custom archive adapter. Keep a
small set of host integration checks for transactional append, malformed
manifest rejection, fresh-instance rolling-summary recovery, missing summary
content, and storage-failure propagation. Add broader provider scenarios only
when a real adapter exposes a portable correctness risk or a public support
claim requires the evidence.
