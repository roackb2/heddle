# `@heddleagent/runtime` 9.1.0

This additive release lets a successful custom heartbeat run prefer one earlier
next run without creating a second wake mechanism or weakening the configured
periodic cadence.

## What changed

- Add `HeartbeatExecutionContext.preferNextRunAt({ at })` for custom heartbeat
  handlers after `context.runAgent()` settles successfully.
- Carry the optional preferred timestamp through claim-fenced task settlement
  and choose the earlier of it and the normally resolved periodic deadline.
- Keep external run requests, retries, blocks, failures, cancellation,
  recovery, disabled tasks, and terminal state authoritative.
- Reject invalid dates, calls before agent settlement, repeated calls, and
  attempts to combine a preferred successful deadline with retry or block.
- Extend executable task-store conformance and integration coverage for
  in-memory, filesystem, and PostgreSQL-backed implementations.

## Adopter boundary

The preference changes timing only. It does not create a run-request generation
or persist product policy in Heddle. Adopters own any model tool, authorization,
product-scoped timestamp, validation, clear operation, and owner-visible
explanation.

After successful settlement the chosen timestamp becomes the task's ordinary
`schedule.nextRunAt`. Heddle intentionally keeps no separate preference
provenance, so clearing adopter state later can leave at most one already
scheduled extra run before the normal cadence resumes.

## Verification

The release is covered by focused execution-context validation, claim-fenced
task-store conformance, scheduler regressions, the repository build and test
baseline, Runtime package build and pack inspection, and a fresh-consumer
import/typecheck against the packed artifact.
