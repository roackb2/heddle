# Delegation

`src/core/delegation` owns bounded parent-to-child agent execution for one root
run. It turns `delegate_task` calls into read-only child executions through the
existing `AgentLoopRuntimeService`; it does not implement another model/tool
loop.

## Boundary

This domain owns:

- v1 policy validation and disabled-by-default activation;
- preallocated root, delegation, and child identities;
- atomic total-child reservation and a per-root concurrency semaphore;
- immutable `builtin:ask` / `builtin:review` snapshot selection;
- the mandatory child read-only tool and approval envelopes;
- fresh child context, adapter creation, cancellation, and step clamping;
- bounded model-facing results and richer in-memory host records.

`DelegationRootScope` owns the mutable per-root graph, reservation semaphore,
and cancellation lifecycle. `DelegationChildRuntimeService` owns concrete
child prompt/tool/approval composition and fresh adapter execution. Keep that
split intact: graph state must not leak into the single-run runtime, and child
authority must not be reconstructed by host callers.

It does not own chat sessions, turn activation, durable records, live UI
projection, provider-native delegation, child worktrees, write authority, or
recursive delegation. Those concerns must stay in their existing host/domain
owners or later feature slices.

## Headless Composition

Delegation is opt-in. Construct a service with an enabled host policy, create
one scope before composing root tools, and pass the same `rootRunId` to the
root runtime:

```ts
const delegation = new DelegationService({
  policy: { enabled: true },
});
const scope = delegation.createRootScope({
  workspaceRoot,
  runtime: {
    model,
    apiKey,
    baseSystemContext,
  },
});

const root = await AgentLoopRuntimeService.run({
  runId: scope.rootRunId,
  goal,
  model,
  apiKey,
  workspaceRoot,
  extraTools: [scope.createTool()],
  abortSignal,
});

const childRuns = scope.records();
```

If a host supplies custom adapters, it must provide `createChildLlm`; the
factory is called once per child and must return a fresh adapter. The service
rejects adapter reuse because concurrent safety is not part of `LlmAdapter`'s
contract.

Ordinary `AgentLoopRuntimeService` callers do not receive `delegate_task`, and
omitting `runId` preserves generated run IDs. Calling `scope.cancel()` aborts
active and queued children. A root runtime's abort signal also reaches every
delegate tool call through the existing tool execution context.

## V1 Safety Invariants

- Depth is exactly one; child registries never contain `delegate_task`.
- At most four children are reserved and at most three execute concurrently by
  default.
- A reservation remains consumed after completion, failure, or cancellation.
- Child step budgets default to 24 and cannot exceed 32.
- Only built-in ask/review snapshots are eligible.
- Snapshot tool selection is intersected with a mandatory capability envelope.
- A separate read-only approval policy remains active as defense in depth.
- Children share the normalized workspace but receive no root history or root
  profile appendix.
- Raw child transcripts and traces never enter model-facing tool output.
- No child is retried automatically or detached from the owning root scope.

`records()` returns defensive copies of the current in-memory records,
including trace and usage. Durable trace sidecars and conversation-turn
summaries are intentionally deferred; do not add persistence to this domain.
