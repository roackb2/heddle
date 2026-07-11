# Conversation Runs

`src/core/chat/runs` owns process-local coordination for long-running
conversation work embedded in a host process.

## Owns

- one active run per host-defined session address;
- stable run IDs and cancellation controllers;
- active-run discovery for hosts reconnecting after a client refresh;
- pending approval resolution;
- ordered `ConversationActivity` delivery;
- bounded replay for reconnecting subscribers;
- result/error/cancellation settlement and cleanup.

## Does not own

- persisted conversation semantics, which remain in `ConversationEngine`;
- HTTP, SSE, tRPC, React, authentication, or tenant policy;
- product-specific result projection;
- durable cross-process event replay.

The Heddle control plane and external programmatic hosts must use this same
service. Do not add a second run coordinator under `src/server` or a product
adapter.

```ts
import { ConversationRunService } from '@roackb2/heddle/hosted'

const runs = new ConversationRunService({
  replay: { maxEventsPerRun: 512, retentionMs: 300_000 },
});

const run = runs.startTurn({
  address: { scopeId: 'tenant-1', sessionId: session.id },
  engine,
  turn: { sessionId: session.id, prompt: 'Revise the current document.' },
});

const activeRun = runs.getActiveRun({
  scopeId: 'tenant-1',
  sessionId: session.id,
});

for await (const item of run.events()) {
  // Serialize through the host's transport without changing Heddle semantics.
}
```

`run.cancel()` and `run.resolveApproval(...)` remain bound to that accepted run
identity. A stale handle cannot affect a later run at the same address.
