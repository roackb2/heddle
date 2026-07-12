# Conversation Runs

`src/core/chat/runs` owns process-local coordination for long-running
conversation work embedded in a host process.

## Owns

- one active run per host-defined session address;
- stable run IDs and cancellation controllers;
- active-run discovery for hosts reconnecting after a client refresh;
- retained run lookup with the host-defined address for authorization;
- pending approval resolution;
- ordered `ConversationActivity` delivery;
- bounded replay for reconnecting subscribers;
- awaited host result projection before terminal publication;
- typed conflict, lookup, replay, and cancellation errors;
- result/error/cancellation settlement and cleanup, including late completion
  after cancellation.

## Does not own

- persisted conversation semantics, which remain in `ConversationEngine`;
- HTTP, SSE, tRPC, React, authentication, or tenant policy;
- the contents of product-specific result projection;
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
  projectResult: async (result, { controller }) => {
    controller.signal.throwIfAborted();
    await productRepository.persist(result);
    return { outcome: result.outcome, summary: result.summary };
  },
});

const activeRun = runs.getActiveRun({
  scopeId: 'tenant-1',
  sessionId: session.id,
});

for await (const item of run.events()) {
  // Serialize through the host's transport without changing Heddle semantics.
}

const retained = runs.getRetainedRun(run.runId);
if (retained?.scopeId !== authenticatedScopeId) {
  throw new Error('Run not found');
}
```

`run.cancel()` and `run.resolveApproval(...)` remain bound to that accepted run
identity. A stale handle cannot affect a later run at the same address.
Cancellation remains authoritative if an executor ignores its abort signal and
resolves late: the result promise rejects and replay ends with `cancelled`.

`projectResult` is the host's transaction boundary between internal engine
output and the retained/public result. It may persist or reconcile product
state and is awaited before the `result` terminal is published. If projection
fails, the run fails instead of reporting a successful terminal prematurely.

`getRetainedRun(...)` returns the original host-defined address with the handle
so the host can authorize subscribe and cancel operations without maintaining a
second run registry. A run ID is only a lookup key; possession is never proof of
authorization.
