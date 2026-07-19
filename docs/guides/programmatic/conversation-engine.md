# Conversation Engine

`createConversationEngine` is the main programmatic API for persisted
conversations. It is the right entrypoint for custom frontends, local tools,
daemon wrappers, or products that want Heddle to own the agent runtime plumbing.

Use it when you want:

- persisted sessions under a host-controlled state root;
- session create/ensure/read/list/rename/delete operations;
- turn submission and continue behavior;
- automatic conversation compaction;
- approval handling through host callbacks;
- assistant streaming, semantic activity, and raw trace callbacks;
- trace persistence, artifact tools, and memory maintenance.

```ts
import { createConversationEngine } from '@roackb2/heddle'

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.4',
  reasoningEffort: 'medium',
})
```

The normalized engine config derives default paths from `stateRoot`:

- session catalog: `stateRoot/chat-sessions.catalog.json`
- per-session bodies: `stateRoot/chat-sessions/<session-id>.json`
- memory directory: `stateRoot/memory`
- trace directory: `stateRoot/traces`
- artifact root: `stateRoot/artifacts`

Use `EngineConversationTurnService.run(...)` only when your host already owns
session ids and storage paths. For new hosts, prefer `createConversationEngine`.

Use `engine.sessions.readExisting(id)` when checking whether a persisted session
already exists. Unlike `read(id)`, it does not materialize Heddle's host-facing
fallback session in an empty repository.

When a host maps a stable product conversation to Heddle, avoid a separate
read-then-create sequence. Use the race-safe ensure operation:

```ts
const { session, created } = await engine.sessions.ensure({
  id: trustedProductConversationId,
  name: 'Product assistant',
})
```

If another process creates the same ID first, `ensure` reads and returns the
winner. Creation fields apply only to a new record; they never rename or change
the model/settings of an existing session. Repository adapters must surface
create collisions as `ChatSessionAlreadyExistsError`, as required by the public
session repository contract.

## Control model-visible tools

Use `toolProfile` to set the engine's default model-visible tool policy. For
example, a host that does not use Heddle-managed memory can keep the ordinary
tool bundle while removing every memory tool:

```ts
const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: 'gpt-5.4',
  toolProfile: {
    preset: 'default',
    memoryMode: 'none',
  },
})
```

This is separate from `memoryMaintenanceMode`. `toolProfile.memoryMode`
controls the memory tools visible to the model, while
`memoryMaintenanceMode` controls post-turn memory maintenance scheduling. If a
turn selects a custom agent, that agent's tool profile overrides the engine
default for the turn.

For host event adapters, import `HeddleEventType` instead of duplicating event
name strings:

```ts
import { HeddleEventType } from '@roackb2/heddle'

if (activity.type === HeddleEventType.assistantStream) {
  renderDelta(activity.text)
}
```

## Stream long-running turns

Use one host-long-lived `ConversationRunService` when HTTP requests or other
transport subscriptions should attach to the same active turn. The conversation
engine continues to own durable session semantics; the run service owns
process-local run identity, cancellation, ordered activity delivery, approvals,
and bounded replay for reconnecting subscribers.

```ts
import { createConversationEngine } from '@roackb2/heddle'
import { ConversationRunService } from '@roackb2/heddle/hosted'

const runs = new ConversationRunService({
  replay: { maxEventsPerRun: 512, retentionMs: 300_000 },
})

const engine = createConversationEngine({ workspaceRoot, stateRoot, model })
const run = runs.startTurn({
  address: { scopeId: tenantId, sessionId },
  engine,
  turn: { sessionId, prompt },
})

for await (const item of run.events()) {
  await transport.send(item)
}

const result = await run.result
```

Reconnect with the same service and the last received sequence:

```ts
for await (const item of runs.subscribe({
  address: { scopeId: tenantId, sessionId },
  runId,
  afterSequence,
  signal,
})) {
  await transport.send(item)
}
```

The replay buffer is intentionally process-local and bounded. Durable final
conversation state remains in the engine's session repository; transports and
cross-process delivery remain host responsibilities.

When a remote client owns a reconnect cursor, pair this service with the
[remote run consumer and protocol codec](remote-runs.md) rather than rebuilding
duplicate/gap/terminal/retry behavior in the client.

For a complete runnable host, follow the
[hosted agent stack example](../../../examples/sdk/05-hosted-agent/README.md). It
uses this exact service for account-scoped start/subscribe/cancel, then adds an
Express/SSE adapter and a framework-neutral browser client without moving HTTP,
authentication, or reconnect policy into the conversation core.

## Reading artifacts

Each turn result already includes the artifacts produced by that turn. To review
all artifacts a session has accumulated (for example, a host `/artifacts`
command), use `engine.artifacts` instead of constructing an `ArtifactService`
against a guessed path:

```ts
const artifacts = engine.artifacts.list({ sessionId: session.id })
const source = engine.artifacts.read(artifactId)?.content
```

`engine.artifacts` is backed by the engine's resolved artifact root, so it stays
correct even when a host extension sets a custom `artifacts.root`. Do not
recompute the artifact root (`stateRoot/artifacts`) in host code — that breaks
when the root is customized.

## Bring your own artifact storage

Hosted services usually cannot persist under a local state root. Implement the
`ArtifactRepository` port and pass it to the engine (or the quickstart runner):

```ts
import { createConversationEngine, type ArtifactRepository } from '@roackb2/heddle'

const artifactRepository: ArtifactRepository = {
  readCatalog: () => loadCatalogFromDatabase(),
  writeCatalog: (store) => saveCatalogToDatabase(store),
  contentKey: (id, extension) => `artifacts/${id}.${extension}`,
  contentExists: (key) => blobExists(key),
  writeContent: (key, content) => putBlob(key, content),
  readContent: (key) => getBlob(key),
}

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: 'gpt-5.4',
  artifactRepository,
})
```

The injected repository is resolved once at the engine boundary and used
everywhere artifacts are persisted or read: `engine.artifacts`, per-turn
artifact listings in turn results, the `save_artifact`/`read_artifact` tool
family, and MCP host-extension result-artifact capture. `contentKey` owns
content addressing — return whatever key your storage understands; it is stored
as `RuntimeArtifact.path`.

## Bring your own conversation storage

Sessions use an async, revisioned `ChatSessionRepository` port. Local products
can keep the zero-configuration file adapter; hosted products can inject a
record-oriented database adapter. A hosted completed-conversation promise must
also inject the archive repository through the same conversation capability.

```ts
import { createConversationEngine, type ChatSessionRepository } from '@roackb2/heddle'

const sessionRepository: ChatSessionRepository = {
  list: async (input) => listSessionPage(input),
  read: async (sessionId) => readSessionRecord(sessionId),
  create: async (session) => createSessionRecord(session),
  update: async (input) => compareAndSwapSession(input),
  delete: async (input) => compareAndSwapSessionDelete(input),
}
```

The session repository is used for
session create/read/update/rename, turn preflight and persistence, lease
acquisition/release, and background memory-maintenance writes. Session policy
(leases, records, compaction state) stays inside Heddle — the repository only
persists. Updates and deletes use expected revisions so a hosted adapter cannot
silently lose a concurrent write.

See [Durable session storage](session-storage.md) for the default JSON layout,
the exact compare-and-swap behavior, and a PostgreSQL table/query shape.

### Complete the capability with compacted-history storage

Long conversations archive exact messages and a cumulative rolling summary
through the async `ChatArchiveRepository`. Hosted services configure both
repositories under `persistence.conversations`; otherwise the active session
can reopen on a new replica while its compacted history still points at local
files.

```ts
import {
  createConversationEngine,
  type ChatArchiveRepository,
} from '@roackb2/heddle'

const archiveRepository: ChatArchiveRepository = {
  loadManifest: async (sessionId) => loadManifest(sessionId),
  readSummary: async (summaryLocator) => loadSummary(summaryLocator),
  append: async (input) => appendArchiveTransaction(input),
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

Bind both repositories to the same server-authenticated account/tenant scope.
The resolved pair and its non-certifying host checklist are available at
`engine.persistence.conversations`. `append` must atomically expose the raw
messages, summary, and returned
manifest; Heddle will not persist compacted session state until it succeeds.
See [Durable session storage](session-storage.md) for the complete contract,
codec helpers, and a PostgreSQL shape.

Traces and memory still persist under the state root today. Any future
persistence capability keeps its own domain contract rather than sharing a
universal storage interface with conversations.
