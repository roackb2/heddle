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

## Request-scoped toolkits and credentials

Hosts that need an exact tool surface can pass `toolkits` together with
`includeDefaultTools: false`. The runtime resolves or acquires the provider
credential once, then builds every toolkit with the existing
`ToolToolkitContext`; hosts should not pre-resolve credentials merely to create
provider-backed tools. `credentialStorePath` can be set independently when a
host's runtime state root and credential store are intentionally different.

Static `tools` remain supported. Toolkit and tool names are duplicate-checked
through the same runtime tool assembly path whether default tools are enabled
or disabled.

## Event delivery

`onEvent` may be synchronous or asynchronous. Synchronous listeners retain
immediate streaming delivery. After a listener returns a Promise, Heddle queues
later callbacks behind it in exact emission order and waits for the complete
chain—including `loop.finished` on successful runs—before the run Promise
settles. A callback rejection rejects the run; hosts therefore never receive a
settled run while required durable activity writes are still pending or failed.

Product schemas, persistence transactions, retry policy, and UI projection stay
outside this lifecycle boundary.

## Tool Concurrency

`maxToolConcurrency` bounds parallel-safe tool execution for one run. The
default is `4`, valid values are integers from `1` through `32`, and `1`
disables overlap.

Calls overlap only when both the active LLM adapter advertises
`parallelToolCalls` and the tool declares `concurrency: 'parallel-safe'`.
Authorization for every tool call in one model response finishes before any
allowed call starts. Undeclared tools remain serial barriers, and results are
projected back into the transcript in the model's original tool-call order.
