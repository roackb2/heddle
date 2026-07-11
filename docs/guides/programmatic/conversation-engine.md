# Conversation Engine

`createConversationEngine` is the main programmatic API for persisted
conversations. It is the right entrypoint for custom frontends, local tools,
daemon wrappers, or products that want Heddle to own the agent runtime plumbing.

Use it when you want:

- persisted sessions under a host-controlled state root;
- session create/read/list/rename/delete operations;
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

## Bring your own session storage

Sessions follow the same pattern through the `ChatSessionRepository` port: the
session catalog plus full session bodies.

```ts
import { createConversationEngine, type ChatSessionRepository } from '@roackb2/heddle'

const sessionRepository: ChatSessionRepository = {
  list: () => loadAllSessions(),
  readCatalog: () => loadSessionCatalogEntries(),
  read: (sessionId) => loadSession(sessionId),
  save: (sessions) => storeSessions(sessions),
}

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model: 'gpt-5.4',
  sessionRepository,
})
```

The injected repository is resolved once at the engine boundary and used for
session create/read/update/rename, turn preflight and persistence, lease
acquisition/release, and background memory-maintenance writes. Session policy
(leases, records, compaction state) stays inside Heddle — the repository only
persists.

Traces and memory still persist under the state root today. Making them
injectable follows the same port-per-domain pattern.
