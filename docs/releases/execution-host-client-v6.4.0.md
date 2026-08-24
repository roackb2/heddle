# Execution Host Client v6.4.0

`@heddleagent/execution-host-client@6.4.0` adds the shared integration boundary
between a product backend and a long-running Heddle heartbeat coordinator.
Products no longer need to recreate coordinator requests, desired-state
reconciliation, Runtime-session derivation, delegation authority, or delegated
heartbeat execution.

## What changed

- add `@heddleagent/execution-host-client/coordinator` with authenticated task
  publication, pause-first desired-state reconciliation, product delegation,
  and delegated execution;
- add `@heddleagent/execution-host-client/coordinator/node` with the standard
  bounded and authenticated Node HTTP edge for product authorization;
- bind task ID, execution ID, Runtime session, product scope, MCP tools, and
  signed authority metadata before a coordinator run can execute; and
- share the existing Node JSON, authorization-redaction, safe-error, and
  shutdown mechanics instead of asking adopters to duplicate them.

## Ownership boundary

The product still owns desired-task projection, authenticated user and agent
authorization, product scope, allowed MCP tools, product data, and product MCP.
The coordinator still owns its database, scheduler, claims, settlement,
history, and recovery. This package supplies the reusable protocol and
composition between those two boundaries; it does not add a hosted coordinator
service or deployment workflow.

## Publication

Publish manually from the tagged release commit. This repository does not
automatically publish packages from `main`.
