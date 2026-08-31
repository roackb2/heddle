# Unreleased

## Planned `@heddleagent/runtime` 7.0.0

- Add final atomic heartbeat claim admission for the store namespace plus one
  optional opaque `HeartbeatTask.admissionGroupId`.
- Add the separate `HeartbeatTaskAdmissionControl` binary `ready | closed`
  port and return `admission-closed` with the blocking target from claim and
  targeted-run results.
- Preserve namespace-only tasks, while missing state for an explicitly assigned
  group fails closed.
- Add exact `recovery` claim mode for the current durable interrupted-execution
  marker. It bypasses closed admission only as a single-use continuation of
  already-admitted logical work, fences the interrupted execution, and leaves
  newer run requests pending. Stale IDs and legacy diagnostic recovery records
  cannot authorize the bypass.

### Upgrade note

This is planned as a Runtime major because `HeartbeatTaskClaimResult`,
`HeartbeatTaskExecutionResult`, and `RunHeartbeatTaskResult` gain the public
`admission-closed` discriminant. Exhaustive TypeScript consumers must handle
that status. Existing task records need no migration when they do not set
`admissionGroupId`.

The adapter conformance harness keeps `createAdmissionControl` optional for
source compatibility. Supplying it is required to run and claim
scoped-admission conformance; omitting it certifies only the legacy
namespace-only store contract.
