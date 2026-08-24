# Hosted heartbeat execution

This module connects Heddle's provider-neutral heartbeat scheduler to a
compatible Execution Host. It lets one long-running coordinator retain durable
task authority while an isolated Runtime performs only the agent cycle.

## Owns

- execution assertion and optional product-MCP capability issuance for the
  `heartbeat-task` workflow;
- request-scoped model credential resolution;
- binding the durable scheduler `executionId` to the hosted `invocationId`;
- bounded task, checkpoint, run-context, and deadline projection;
- ordered activity/result consumption, cancellation, and safe public failure;
  and
- product-supplied resolution of authorized scope and Runtime session.

## Does not own

- heartbeat task lookup, due selection, claim fencing, checkpoint persistence,
  settlement, history, or recovery;
- the product's tenant/session authorization or AgentCore Runtime allocation;
- PostgreSQL credentials inside the Runtime;
- a general workflow engine, queue, foreground request relay, or hosted SaaS
  control plane; or
- memory, workspace, or filesystem checkpointing.

The coordinator supplies `HostedHeartbeatAgentExecutionTransport` to
`HeartbeatSchedulerService`. The scheduler's existing local runner remains the
default when no transport is configured. This low-level transport is suitable
when product authority and the coordinator live in the same process.

For a separately deployed product backend, use the higher-level
[`coordinator`](../coordinator/README.md) surface. It owns the authenticated
task/delegation clients, desired-state reconciliation, Runtime-session and
authority construction, and delegated execution composition. Product code then
returns only its authorized scope and allowed tools rather than implementing
`resolveInvocationContext` or the delegation wire shape.

The returned value crosses an untrusted network boundary. The runtime scheduler
validates it as an `AgentHeartbeatResult` before any checkpoint or successful
task settlement is committed.
