# Unreleased

## Heartbeat SDK

- Added provider-neutral targeted heartbeat execution for request-driven and
  ephemeral workers. Hosts can route one durable task ID through
  `HeartbeatSchedulerService.runTask()`, while Heddle performs direct lookup,
  an atomic due claim, and claim-fenced settlement through the standard runner
  pipeline. Queue delivery, lease recovery, tenant authorization, and domain
  idempotency remain host responsibilities; this is not an exactly-once
  execution guarantee.
- Added an opt-in custom-store conformance suite at
  `@roackb2/heddle/heartbeat/testing` and a deterministic ephemeral-worker
  example.
