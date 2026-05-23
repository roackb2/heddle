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
  `HeartbeatTaskStateProjector` owns task state transitions after success or
  failure.
- `scheduler/`: `HeartbeatSchedulerService` owns due-task selection and the
  periodic scheduler loop. It delegates execution to
  `HeartbeatTaskRunnerService` instead of running tasks itself. Daemon, CLI,
  and future hosts should start or run the scheduler through this service
  instead of constructing task repositories or duplicating loop logic.
- `scheduler/runner.ts`: `HeartbeatTaskRunnerService` owns one task execution:
  checkpoint loading, runner-agent invocation, checkpoint persistence, task
  state transitions, and run history persistence.
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
- Heartbeat may depend on runtime's public `AgentLoopRuntimeService.run` and checkpoint types.
  Runtime should not import heartbeat.
- When this domain is refactored further, follow the `src/core/chat/engine`
  pattern: class-backed owning services/repositories, local `types.ts` contracts,
  schema-owned persistence validation, and no compatibility wrappers.
