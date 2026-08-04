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
- `tasks/`: `FileHeartbeatTaskService` is the persistence boundary for durable
  task/checkpoint/run storage and task/run projections. It is the only
  non-repository service that should instantiate `FileHeartbeatTaskRepository`.
  It also owns process-local execution claims, recovery of interrupted
  single-host executions, and fencing of late completion/failure/outcome
  writes. Durable run-request generations and the file adapter's process-local
  scheduler wake signal also live here. `HeartbeatTaskStateProjector` owns task
  state transitions after agent success, no-work skip, cancellation, failure,
  request, claim, or recovery.
- `scheduler/`: `HeartbeatSchedulerService` owns due-task selection and the
  periodic scheduler loop. It selects due work in stable oldest-due-first order
  and uses `p-limit` to enforce the configured task concurrency ceiling. It delegates execution to
  `HeartbeatTaskRunnerService` instead of running tasks itself. Daemon, CLI,
  and future hosts should start or run the scheduler through this service
  instead of constructing task repositories or duplicating loop logic.
- `scheduler/runner.ts`: `HeartbeatTaskRunnerService` owns one task execution:
  checkpoint loading, handler invocation, runner-agent invocation, abort
  propagation, checkpoint persistence, task state transitions, and execution
  history persistence. Default and custom handlers share its framework-owned
  `context.runAgent()` path, so hosts can add domain prompts and tools without
  receiving or translating provider credentials. `context.skip()` records
  explicit no-work without fabricating agent state.
- `views/`: `HeartbeatLucidPresenter` owns Lucid-specific adapter messages.
  Generic task/run view projection belongs to `FileHeartbeatTaskService`,
  because that service owns the task persistence boundary.

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
- `executionOwnerId` identifies one scheduler process/worker generation. Do not
  reuse it across process restarts: scheduler startup uses it to distinguish a
  current claim from an execution interrupted by the prior single-host process.
- `maxConcurrentTasks` defaults to `1`. The scheduler may run different task IDs
  concurrently, but every execution still passes through the store's atomic
  claim and fencing contract. Aggregate records retain selected-task order even
  when completion events arrive in another order.
- The file service serializes claim/recover/complete/fail transitions with a
  shared in-process mutex, serializes task control read-transform-write
  transitions, and tracks live executions in process memory. Its process-local
  wake signal reduces event latency; polling remains the restart fallback. This is
  reliable for one Node.js process owning a state root; it is not a distributed
  lease. Multiple processes or replicas must provide a remote
  `HeartbeatTaskStore` that implements atomic claim, fencing, and recovery with
  database compare-and-swap, leases, or transactions.
- Recovery preserves the latest checkpoint and run history, records the
  interrupted execution identity under `task.state.recovery`, and makes an
  enabled task immediately due. It does not record success or roll back host
  domain side effects; host tools remain responsible for idempotent mutations.
- Heartbeat may depend on runtime's public `AgentLoopRuntimeService.run` and checkpoint types.
  Runtime should not import heartbeat.
- Interface adapters should use `FileHeartbeatTaskService` methods or the
  control-plane heartbeat API as the public task/run contract. Terminal command
  code should not construct `HeartbeatTask` objects, write heartbeat JSON, or run
  its own scheduler loop.
- A custom scheduler handler may claim domain work before model execution. It
  must either delegate model work to execution-scoped `context.runAgent()` or
  return `context.skip()` when no work exists. The context owns model credential
  resolution, OAuth refresh, unattended approval defaults, checkpoint
  continuation, abort propagation, and heartbeat event forwarding. It is valid
  only during the current execution and must never be serialized or retained by
  the host. The positional runner API is deprecated and adapted through this
  same pipeline.
- `HeartbeatSchedulerService.start()` returns an awaitable, idempotent stop
  handle. Hosts must await `stop({ cancelRunning: true })` before resetting
  domain state. Stop prevents bounded-pool jobs that are still queued from being
  admitted. A handler that ignores its abort signal delays stop until active
  work settles; final writes remain fenced by the execution claim.
- `heddle heartbeat run` and `heddle heartbeat start` are server-backed command
  paths. The control-plane server owns recurring scheduler lifetime; CLI
  commands may request due-task execution or keep an embedded server alive, but
  should not own recurring heartbeat execution policy.
- When this domain is refactored further, follow the `src/core/chat/engine`
  pattern: class-backed owning services/repositories, local `types.ts` contracts,
  schema-owned persistence validation, and compatibility adapters only at
  public boundaries rather than parallel internal pipelines.
