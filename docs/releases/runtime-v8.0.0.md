# `@heddleagent/runtime` 8.0.0

This major release adds explicit terminal completion for successful tools and
successful host-owned heartbeat work without fabricating an agent result.

## What changed

- Add `ToolDefinition.returnDirect` so a successful terminal tool can complete
  the current run from its result without requesting another model turn.
  Failed tool results remain recoverable by the agent, and existing tools keep
  the previous behavior unless they opt in.
- Add `HeartbeatExecutionContext.complete({ summary })` for custom handlers
  that successfully perform host-owned work without calling `runAgent()`.
- Persist that heartbeat settlement as the distinct non-agent `completed`
  outcome, emit `heartbeat.task.completed`, retain the task checkpoint, and
  schedule the next interval for enabled recurring tasks.
- Extend task, run, event, control-plane, and executable store-conformance
  projections so adapters can preserve the successful non-agent outcome
  without inventing an agent run ID or result.

## Upgrade note

This is a major release because `HeartbeatExecutionContext`,
`HeartbeatHandlerOutcome`, `HeartbeatTaskExecutionOutcome`,
`HeartbeatTaskNonAgentRunRecord`, `HeartbeatSchedulerEvent`, and
`HeartbeatTaskStore.recordTaskExecutionOutcome` gain the public `completed`
case. Custom stores, event codecs, and exhaustive TypeScript consumers must
handle that variant before upgrading.

Custom handlers must still settle each execution exactly once. Use
`complete()` only after successful host-owned work, keep its durable summary
concise and non-secret, and use `skip()`, `retry()`, or `blocked()` for their
existing meanings. Product identity, policy, payload persistence, and effects
remain host-owned.

Use `returnDirect` only for tools whose successful output is a complete,
user-facing run result. String outputs become the result summary directly;
other outputs are JSON serialized.

## Verification

The release candidate is verified with the repository build and test baseline,
Runtime package build, npm dry-run packaging, focused terminal-tool and
heartbeat coverage, and release-range review from `runtime-v7.1.1` through the
release-preparation commit.
