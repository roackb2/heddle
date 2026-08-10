# Heartbeat

Heartbeat owns bounded autonomous runner-agent cycles.

This domain sits beside `src/core/runtime` instead of inside it. Runtime owns the
generic agent-loop host API; heartbeat owns scheduled/background task semantics,
checkpoint reuse, task/run persistence, scheduler state projection, and
operator-facing heartbeat views.

## Owns

- `agent/`: `HeartbeatRunnerAgent` owns one autonomous runner-agent cycle on top of
  `AgentLoopRuntimeService.run`, with prompt and decision policy classes kept
  beside it.
- `checkpoint/`: `StoredHeartbeatService` and
  `FileHeartbeatCheckpointRepository` own checkpoint-backed one-off heartbeat
  execution.
- `tasks/`: `HeartbeatTaskAdministrationService` is the provider-neutral
  operator boundary for task creation, updates, pause/resume, deletion,
  reconciliation, and task/run reads. `HeartbeatTaskControlPolicy` owns the
  pure task projections behind those operations. `FileHeartbeatTaskService`
  implements that boundary together with task/checkpoint/run persistence. It is
  the only non-repository service that should instantiate
  `FileHeartbeatTaskRepository`. It also owns process-local execution claims,
  recovery of interrupted single-host executions, fencing of late completion/
  failure/outcome writes, durable run-request generations, and the file
  adapter's process-local scheduler wake signal. `HeartbeatTaskStateProjector`
  owns task state transitions after agent success, no-work skip, cancellation,
  failure, request, claim, or recovery.
- `scheduler/`: `HeartbeatSchedulerService` owns due-task selection and the
  periodic scheduler loop. It selects due work in stable oldest-due-first order
  and uses `p-limit` to enforce the configured task concurrency ceiling. It delegates execution to
  `HeartbeatTaskRunnerService` instead of running tasks itself. Daemon, CLI,
  and future hosts should start or run the scheduler through this service
  instead of constructing task repositories or duplicating loop logic.
- `scheduler/task-lifecycle.ts`: `HeartbeatSchedulerTaskLifecycle` owns the
  process-local task admission generation, task-scoped abort delivery, and
  awaitable settlement registry for one `start()` handle. Durable claims and
  final fencing remain store responsibilities. It intentionally does not route
  cancellation to executions owned by another process or scheduler handle.
- `scheduler/runner.ts`: `HeartbeatTaskRunnerService` owns one task execution:
  checkpoint loading, handler invocation, runner-agent invocation, abort
  propagation, checkpoint persistence, task state transitions, and execution
  history persistence. Default and custom handlers share its framework-owned
  `context.runAgent()` path, so hosts can add domain prompts and tools without
  receiving or translating provider credentials. `context.skip()` records
  explicit no-work without fabricating agent state.
- `views/`: `HeartbeatLucidPresenter` owns Lucid-specific adapter messages.
  `HeartbeatTaskViewProjector` owns provider-neutral task/run views and stable
  task ordering without depending on a persistence adapter.

## Does Not Own

- Generic runtime events, agent-loop checkpoints, or default tool assembly. Those
  stay in `src/core/runtime`.
- Interactive chat sessions, conversation turns, compaction, or session
  persistence. Those stay in `src/core/chat`.
- CLI, server, web, or TUI presentation. Those surfaces should call this domain
  through typed heartbeat entry points.

## Boundary Notes

- Keep scheduler/task persistence concerns here, not in runtime.
- `executionId` is the fencing token for one task attempt. A store must reject
  completion, failure, skip, or cancellation persistence when that execution
  no longer owns the task.
- Run requests are durable, level-triggered intent. `generation` advances for
  accepted requests, `claimedGeneration` identifies work already admitted, and
  an execution records the request generation it claimed. Multiple requests
  may coalesce into one pending follow-up, but a request after claim belongs to
  a later execution.
- Execution settlement must read and project from the latest stored task inside
  the same atomic store transition. Saving a projection derived from the
  pre-run snapshot can erase newer run requests or operator control changes.
- Custom adapters should use the public `HeartbeatTaskStateProjector` exported
  from `@roackb2/heddle/advanced` for normalization, request, claim,
  settlement, and recovery transitions. The adapter still owns the backend
  transaction and fencing predicate; it must not copy Heddle's transition
  rules into provider-specific persistence code.
- Operator-facing adapters should implement the public
  `HeartbeatTaskAdministrationService` and use `HeartbeatTaskControlPolicy`
  plus `HeartbeatTaskViewProjector`. Every mutation must lock or compare-and-set
  the latest durable task before applying the policy. The pure policy does not
  make a separate `loadTask()` followed by `saveTask()` atomic.
- `executionOwnerId` identifies one scheduler process/worker generation. Do not
  reuse it across process restarts: scheduler startup uses it to distinguish a
  current claim from an execution interrupted by the prior single-host process.
- `maxConcurrentTasks` defaults to `1`. The scheduler may run different task IDs
  concurrently, but every execution still passes through the store's atomic
  claim and fencing contract. Aggregate records retain selected-task order even
  when completion events arrive in another order.
- `HeartbeatSchedulerService.runTask({ taskId, store, executionOwnerId, ... })`
  is the targeted one-shot boundary for an ephemeral worker that was already
  routed one task by its host. It requires `HeartbeatTargetedTaskStore`, whose
  `loadTask(taskId)` resolves that task directly rather than scanning a global
  catalog. The method reads durable eligibility and makes the final due claim
  through the store; its typed result distinguishes settlement, normal failure,
  missing/disabled/not-due/busy work, a lost claim, and cancellation.
- The one-shot `runTask()` method does not scan unrelated tasks, poll, subscribe,
  or recover interrupted executions. `HeartbeatTargetedTaskHost` is the
  low-volume in-process default around that primitive: it owns notification
  coalescing, polling fallback, bounded local delivery, cancellation, and
  recovery cadence. It is not a distributed queue or authorization boundary.
  Queue visibility, cross-replica admission, tenant authorization, and
  host-domain idempotency remain host responsibilities. The store's atomic
  claim fences duplicate at-least-once worker deliveries; it does not make host
  tool side effects exactly once.
- The file service serializes task/checkpoint/run mutations with a shared
  in-process mutex for one resolved heartbeat root. Task, checkpoint, and run
  JSON files are replaced atomically, so readers see a complete previous or next
  document rather than a partial write. Concurrent
  `createTask` calls for the same ID produce one creation and one explicit
  conflict; distinct IDs are independent. `reconcileTasks({ namespace, desired
  })` atomically creates missing members and removes obsolete non-running members
  from one host-owned namespace, while retaining existing configuration/state and
  never rewriting a live running claim. Use the explicit task update APIs for
  existing-task configuration changes. Its process-local wake signal reduces event
  latency; polling remains the restart fallback. This is reliable for one Node.js
  process owning a state root; it is not a distributed lease. Multiple processes
  or replicas must provide a remote
  `HeartbeatTaskStore` that implements atomic claim, fencing, and recovery with
  database compare-and-swap, leases, or transactions.
- Recovery preserves the latest checkpoint and run history, records the
  interrupted execution identity under `task.state.recovery`, and makes an
  enabled task immediately due. It does not record success or roll back host
  domain side effects; host tools remain responsible for idempotent mutations.
- Recovery is a lifecycle policy, not a consequence of receiving a different
  `ownerId`. The built-in file adapter can recover an execution only when its
  in-process active-execution registry proves it is no longer live. A remote
  adapter must use its own lease-expiry or operator recovery policy. A targeted
  invocation never performs recovery or steals another worker's live claim;
  final writes remain fenced after an explicit recovery.
- Custom remote adapters should run the executable contract scenarios from
  `@roackb2/heddle/heartbeat/testing` against two fresh store instances sharing
  one backend namespace. Required scenarios cover exact lookup, atomic due
  claims, coalesced requests, settlement, recovery, and stale-write fencing;
  history and subscription checks are capability-gated. The harness owns a
  fixture-only hook for expiring a lease or simulating a dead prior process.
  Passing the suite does not certify host queue delivery or exactly-once domain
  effects.
- Heartbeat may depend on runtime's public `AgentLoopRuntimeService.run` and checkpoint types.
  Runtime should not import heartbeat.
- Local interface adapters should use `FileHeartbeatTaskService` methods or the
  control-plane heartbeat API. Remote operator surfaces should depend on
  `HeartbeatTaskAdministrationService` and keep backend transaction mechanics
  behind their implementation. Terminal command code should not construct
  `HeartbeatTask` objects, write heartbeat JSON, or run its own scheduler loop.
- A custom scheduler handler may claim domain work before model execution. It
  must either delegate model work to execution-scoped `context.runAgent()` or
  return `context.skip()` when no work exists. The context owns model credential
  resolution, OAuth refresh, unattended approval defaults, checkpoint
  continuation, abort propagation, and heartbeat event forwarding. It is valid
  only during the current execution and must never be serialized or retained by
  the host. The positional runner API is deprecated and adapted through this
  same pipeline.
- A custom handler can reject a completed nested agent result without throwing
  by returning `context.retry()` or `context.block()` after `await
  context.runAgent()`. Retry retains the previous checkpoint, records a
  claim-fenced non-agent outcome, and schedules one bounded retry delay.
  Block retains the previous checkpoint, records the nested agent run id for
  correlation, disables the task, and requires `resumeTask()` before another
  run. Handler-outcome summaries are durable operator text: keep them concise,
  non-secret, and free of prompts or domain payloads.

```ts
handler: async (context) => {
  const result = await context.runAgent();
  if (!hostPostconditionsAccept(result)) {
    return context.retry({
      summary: 'Host postconditions did not accept this run.',
      delayMs: 30_000,
    });
  }
  if (requiresExplicitResume(result)) {
    return context.block({ summary: 'This task requires explicit operator resume.' });
  }
  return result;
}
```
- `HeartbeatSchedulerService.start()` returns an awaitable, idempotent stop
  handle. Hosts must await `stop({ cancelRunning: true })` before resetting
  domain state. Stop prevents bounded-pool jobs that are still queued from being
  admitted. A handler that ignores its abort signal delays stop until active
  work settles; final writes remain fenced by the execution claim.
- The same handle exposes `cancelTask(taskId, { reason })` for task-scoped
  quiescence. It invalidates already-queued admissions for that task, aborts an
  execution only when this handle owns it, and resolves after claim-fenced
  settlement. Concurrent callers share one cancellation attempt. The method
  does not disable/delete a task, consume a newer run-request generation, roll
  back host side effects, or claim remote cancellation delivery; `not-owned`
  tells an adapter host that another worker must be contacted through its own
  durable routing mechanism.
- `HeartbeatSchedulerService.start({ store })` uses the caller-provided
  `HeartbeatTaskStore` instance for startup recovery, run-request wakeups, due
  selection, claims, settlement, and run history. `stateRoot` still locates
  framework-owned agent runtime state; it only locates heartbeat task files
  when `store` is omitted. A remote adapter must provide its own atomic claim,
  fencing, recovery, and cross-process notification guarantees.
- `heddle heartbeat run` and `heddle heartbeat start` are server-backed command
  paths. The control-plane server owns recurring scheduler lifetime; CLI
  commands may request due-task execution or keep an embedded server alive, but
  should not own recurring heartbeat execution policy.
- When this domain is refactored further, follow the `src/core/chat/engine`
  pattern: class-backed owning services/repositories, local `types.ts` contracts,
  schema-owned persistence validation, and compatibility adapters only at
  public boundaries rather than parallel internal pipelines.
