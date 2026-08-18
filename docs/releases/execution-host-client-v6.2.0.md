# Execution Host Client v6.2.0

`@heddleagent/execution-host-client@6.2.0` adds an explicit
`heartbeat-task` workflow so a Heddle coordinator can delegate one agent cycle
to a compatible Execution Host without sharing its durable database.

## What changed

- add `@heddleagent/execution-host-client/heartbeat` with reusable authority,
  model-credential, optional MCP, cancellation, and result orchestration;
- extend the direct HTTP/SSE and AgentCore transports with a strict heartbeat
  port using the same one-attempt, clean-EOF protocol rules as conversations;
- add the heartbeat request and stream profiles to the v1 OpenAPI, JSON Schema,
  golden fixtures, and clean-room Python conformance reference; and
- keep product scope/Runtime-session resolution as the small adopter callback
  while Heddle owns the security-sensitive hosted mechanics.

The package does not deploy an Execution Host, allocate AgentCore sessions,
store heartbeat tasks, or receive PostgreSQL credentials. The coordinator owns
durable scheduling and settlement; the isolated Runtime owns only execution.

## Publication

Publish manually from the reviewed release commit. This repository does not
automatically publish packages from `main`.
