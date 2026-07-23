# Runtime Loop

The loop subdomain owns one evented agent execution without persisted chat
session semantics.

`AgentLoopRuntimeService.run(...)` is the main entry point. It resolves the
model/provider/runtime credentials, builds default tools when requested, emits
host-facing loop events, calls `AgentRunService.run(...)`, and returns the final
checkpointable loop state.

Use `AgentLoopCheckpointService` for state/checkpoint conversion and resume
history extraction. Do not put chat sessions, heartbeat scheduling, or host UI
logic in this folder.

## Tool Concurrency

`maxToolConcurrency` bounds parallel-safe tool execution for one run. The
default is `4`, valid values are integers from `1` through `32`, and `1`
disables overlap.

Calls overlap only when both the active LLM adapter advertises
`parallelToolCalls` and the tool declares `concurrency: 'parallel-safe'`.
Authorization for every tool call in one model response finishes before any
allowed call starts. Undeclared tools remain serial barriers, and results are
projected back into the transcript in the model's original tool-call order.
