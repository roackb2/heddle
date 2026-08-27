# Delegation

`src/core/delegation` owns bounded parent-to-child agent execution for one root
run. It turns `delegate_task` calls into child executions through the existing
`AgentLoopRuntimeService`; it does not implement another model/tool loop. Ask
and Review children are read-only. A main agent may explicitly select Code to
grant a child a bounded action catalog within the main agent's existing tool
and permission ceilings.

## Boundary

This domain owns:

- policy validation and disabled-by-default low-level activation;
- preallocated root, delegation, and child identities;
- atomic total-child reservation, a per-root concurrency semaphore, and
  serialized action-child execution;
- immutable `builtin:ask`, `builtin:review`, and `builtin:code` snapshot
  selection;
- exact read-only and action-capable child tool envelopes;
- action-tool intersection with the effective root tool catalog;
- reuse of the root approval policy chain and host approval surface;
- fresh child context, adapter creation, cancellation, step clamping, and a
  validated per-child execution deadline;
- correlated delegation lifecycle and wrapped child conversation activity;
- bounded model-facing results, richer in-memory host records, and a
  terminal-only snapshot for the owning conversation turn.

`DelegationRootScope` owns the mutable per-root graph, reservation semaphore,
and cancellation lifecycle. `DelegationChildRuntimeService` owns concrete
child prompt/tool/approval composition and fresh adapter execution. Keep that
split intact: graph state must not leak into the single-run runtime, and child
authority must not be reconstructed by host callers.

It does not own chat sessions, turn activation, durable storage, live UI
rendering, provider-native delegation, child worktrees, root permission modes,
or recursive delegation. Those concerns stay in their existing host/domain
owners. The delegation scope only proves that its records are settled before
the conversation domain persists a projection. Action children operate in the
same workspace as the root; worktree isolation is not implied.

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
  onActivity: (activity) => host.publishActivity(activity),
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
delegate tool call through the existing tool execution context. Hosts that may
exit the root turn on an exceptional path should await `scope.cancelAndWait()`
so every reserved child reaches a settled record before the scope is released.

`delegate_task` disables the tools domain's generic 30-second wrapper timeout
because one call owns a complete child loop. The delegation domain instead
owns a five-minute default child deadline, configurable from one second through
fifteen minutes. Root cancellation and child step limits remain independently
active.

### Granting bounded actions in a headless host

The low-level service defaults to Ask and Review. A host must opt Code into its
policy and pass the root's effective tools, approval policies, and approval
surface to make action delegation available:

```ts
const rootTools = RuntimeToolService.createDefaultAgentTools({
  model,
  workspaceRoot,
})
const approvalPolicies = hostApprovalPolicies

const scope = new DelegationService({
  policy: {
    enabled: true,
    allowedAgentProfileIds: ['builtin:ask', 'builtin:review', 'builtin:code'],
  },
}).createRootScope({
  workspaceRoot,
  runtime: {
    model,
    parentTools: rootTools,
    approvalPolicies,
    approveToolCall: host.approveToolCall,
  },
})
```

`builtin:code` is omitted from the model-visible schema if the effective root
catalog has no mutation tool. Selecting it in a `delegate_task` call is the
main agent's explicit authority grant for that child. Omitting
`agentProfileId` still chooses read-only Ask when available. Tool execution
then follows the existing root permission behavior: an action may be allowed,
denied, or sent to the same human approval surface. Delegation does not add a
second permission mode.

## Conversation Engine Composition

The lower-level `DelegationService` stays disabled by default so an ordinary
single-run caller never gains a tool implicitly. `createConversationEngine`
owns a different product-level default: it creates one enabled root scope per
turn and exposes `delegate_task` unless the engine or turn selects `off`.

The root model decides whether a task benefits from delegation; there is no
per-turn enable gate. It must explicitly select `builtin:code` when a child
needs actions; ordinary Ask and Review children stay read-only. The Code option
is visible only when the selected root agent itself has mutation tools. An
engine-level `off` is an authority ceiling, so a turn cannot re-enable it. The
conversation turn result includes a settled scope
snapshot in memory and omits it when delegation is off. Completed child
records are also projected into optional `TurnSummary.delegations` on the
parent turn, so they follow the existing conversation repository and its
eight-turn summary retention.

Conversation hosts receive `delegation.started`, `delegation.finished`,
`delegation.cancelled`, and `delegation.rejected` lifecycle activities with the
root, parent, delegation, and child run IDs. Child conversation activity is
published as `delegation.child.activity` with the same correlation fields. It
must stay wrapped: publishing a child `loop.finished` as an ordinary root
activity would let existing clients mistake child settlement for root-turn
settlement. Redundant child `assistant.stream` draft snapshots are omitted;
`delegation.finished.summary` carries the completed child answer while tool,
reasoning, warning, cancellation, and loop progress remain visible.
The first purpose-built client projection shows correlated live child rows and
settled task/profile/status/summary records in both web-v2 and cli-v2. It does
not expose raw child transcripts, traces, model/provider details, or child
permission controls; those remain outside this slice.

## Safety Invariants

- Depth is exactly one; child registries never contain `delegate_task`.
- At most four children are reserved and at most three execute concurrently by
  default.
- A reservation remains consumed after completion, failure, or cancellation.
- Child step budgets default to 24 and cannot exceed 32.
- Child wall time defaults to five minutes and cannot exceed fifteen minutes.
- Only built-in Ask, Review, and Code snapshots are eligible.
- Ask and Review receive only `project_dashboard`, `list_files`, `read_file`,
  and `search_files`.
- Code receives only those four tools plus `edit_file`, `delete_file`,
  `move_file`, `run_shell_inspect`, and `run_shell_mutate`. Each action tool
  must also exist in the effective root catalog.
- Action children execute one at a time within the existing global child
  concurrency limit. Read-only children may still execute in parallel.
- Agent-skill activation is unavailable to children so the inherited base
  context plus immutable child-profile appendix remain the complete child
  system context.
- A delegation-owned approval policy independently enforces the same exact
  tool-name and capability allowlist. Code children then reuse the root's
  effective approval policy chain and human approval callback.
- Children never receive memory, artifact, browser, MCP, skill, or delegation
  tools.
- Children share the normalized workspace but receive no root history or root
  profile appendix.
- Raw child transcripts and traces never enter model-facing tool output.
- No child is retried automatically or detached from the owning root scope.

`records()` returns defensive copies of the current in-memory records,
including trace and usage. `settledSnapshot()` fails closed if any reserved
child is still running. The conversation turn owner removes raw trace and
top-level model/provider fields before persistence while retaining correlation,
the exact agent snapshot, outcome, safe failure, usage, and timestamps. Raw
child trace sidecars and in-flight recovery remain deferred; do not add those
persistence concerns to this domain.
