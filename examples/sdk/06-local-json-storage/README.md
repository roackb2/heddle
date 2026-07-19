# Local JSON conversation storage

This Stage 06 example is the smallest production-honest persistence posture for
a Heddle conversation agent. It uses the default file repositories, needs no
database adapter, and makes completed sessions plus compacted archives survive
a process restart on one host.

Use it for a local-first product, desktop/server process, or one durable server
whose `stateRoot` is on a persistent local volume. Use the sibling
[PostgreSQL + Drizzle reference](../06-postgres-drizzle-storage/README.md) when
conversation state must follow requests across replicas or machines.

## Run the recovery proof

No model credential is required:

```bash
yarn example:local-json-storage:verify
```

The script creates an isolated verification state root beneath
`.heddle/examples/local-json-storage` by default and leaves it available for
inspection. Point the parent at a non-production mounted volume when validating
a deployment image:

```bash
HEDDLE_EXAMPLE_STATE_ROOT=/mnt/app-data/heddle \
  yarn example:local-json-storage:verify
```

It verifies only the focused local promise:

1. the engine resolves the paired default session and archive repositories;
2. a fresh engine recovers the session, archive manifest, and rolling summary;
3. a stopped-writer snapshot of the complete `stateRoot` can be restored; and
4. the readiness report still names persistent-volume and backup/restore checks
   that the deployment owner must satisfy.

This is intentionally not a broad conformance suite and does not execute a
model turn. The verification-only archive linkage in `verify.ts` emulates the
state that Heddle compaction normally owns.

## Compose the production process

Choose the data directory in the host's composition root. Do not let a
container image or ephemeral working directory choose it implicitly:

```ts
import { createConversationEngine } from '@roackb2/heddle'

const stateRoot = process.env.AGENT_STATE_ROOT?.trim()
if (!stateRoot) {
  throw new Error('AGENT_STATE_ROOT must point at the mounted persistent volume')
}

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot,
  model: 'gpt-5.4',
})

console.log(engine.persistence.conversations.readiness)
```

No repository injection is needed. Heddle creates both defaults from the same
`stateRoot`:

- `chat-sessions.catalog.json` plus immutable session revisions; and
- `chat-sessions/<session-id>/archives` for compacted messages, summaries, and
  manifests.

The file adapters use process-aware locks and atomic replacement on a normal
local filesystem. Multiple processes on that one filesystem can coordinate,
but this does not turn an object-store mount or replicated network filesystem
into supported multi-replica storage.

## Operations contract

Before promising local durability to users:

- mount the complete `stateRoot` on persistent storage with local rename and
  locking semantics;
- ensure only the intended application identity can read it, because sessions,
  traces, artifacts, and other local state can contain user data;
- stop writers or take one atomic filesystem snapshot before backup;
- back up the entire directory, not only the session catalog or archive
  manifest;
- restore the entire directory into a staging instance and run a fresh-process
  recovery check before relying on the backup; and
- monitor capacity and define retention/deletion for the whole local state
  surface.

The default files do **not** promise that a different replica can immediately
continue the conversation, and active runs, pending approvals, cancellation,
or SSE replay do not survive executor loss. A new machine can recover only
after the same complete volume is restored and mounted. These limits are the
honest local-durable boundary, not failures of the example.
