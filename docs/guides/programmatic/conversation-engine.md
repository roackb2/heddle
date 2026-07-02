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
