# Durable Session Storage

Heddle owns conversation-session semantics: messages, turns, leases, queued
prompts, compaction metadata, and optimistic mutation coordination. A host owns
where those records live and how an authenticated product user is scoped to
them.

Use the default JSON adapter for one-machine/local-first products. Inject a
`ChatSessionRepository` for hosted or multi-process products that already have
a database.

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
import {
  createConversationEngine,
  FileChatSessionRepository,
} from '@roackb2/heddle'

const sessionStoragePath = join(dataDir, 'agent-sessions.catalog.json')
const engine = createConversationEngine({
  workspaceRoot,
  stateRoot: dataDir,
  model: 'gpt-5.4',
  sessionRepository: new FileChatSessionRepository({ sessionStoragePath }),
})
```

The file adapter serializes writers across processes and uses immutable session
bodies plus atomic catalog replacement. Keep the directory on a filesystem
with normal local rename/locking semantics; do not put it on an eventually
consistent object-store mount.

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

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: 'gpt-5.4',
  sessionRepository,
})
```

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

## Required behavior

Before using a custom adapter in production, verify:

- two writers updating the same revision cannot lose one another's changes;
- the adapter distinguishes missing, already-existing, and conflicting rows;
- cursor pages neither skip nor repeat rows when timestamps tie;
- archived/workspace filters are enforced within the authorized scope;
- a second engine/process can reopen a session and continue its messages,
  turns, queue, lease, and compaction state;
- storage errors reach the host as failures rather than being reported as a
  successful turn.

See the repository's local
[`README.md`](../../../src/core/chat/engine/sessions/repository/README.md) for
the exact adapter boundary and file-layout details.
