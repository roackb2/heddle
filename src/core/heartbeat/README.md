# Heartbeat

Heartbeat owns bounded autonomous wake cycles.

This domain sits beside `src/core/runtime` instead of inside it. Runtime owns the
generic agent-loop host API; heartbeat owns scheduled/background task semantics,
checkpoint reuse, task/run persistence, scheduler state projection, and
operator-facing heartbeat views.

## Owns

- `wake/`: `HeartbeatWakeService` owns one heartbeat wake cycle on top of
  `AgentLoopRuntimeService.run`, with prompt and decision policy classes kept
  beside it.
- `checkpoint/`: `StoredHeartbeatService` and
  `FileHeartbeatCheckpointRepository` own checkpoint-backed one-off heartbeat
  execution.
- `tasks/`: `FileHeartbeatTaskRepository` owns durable task/checkpoint/run
  storage through zod-backed schemas; `HeartbeatTaskStateProjector` owns task
  state transitions after success or failure.
- `scheduler/`: `HeartbeatSchedulerService` owns due-task selection and the
  scheduler loop; `HeartbeatTaskRunnerService` is the narrow task-to-wake
  translation boundary.
- `views/`: `HeartbeatViewsPresenter` and `HeartbeatLucidPresenter` own
  operator-facing heartbeat projections.

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
