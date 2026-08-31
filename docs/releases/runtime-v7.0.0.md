# `@heddleagent/runtime` 7.0.0

This major release adds durable, provider-neutral admission control for
heartbeat tasks without moving hosted lifecycle policy into Heddle.

## What changed

- add final atomic heartbeat claim admission for the store namespace and one
  optional opaque `HeartbeatTask.admissionGroupId`;
- add the separate `HeartbeatTaskAdmissionControl` binary `ready | closed`
  port and return `admission-closed` with the blocking target from claim and
  targeted-run results;
- preserve namespace-only behavior for existing tasks, while a task assigned
  to a group with no durable decision fails closed;
- add exact, single-use `recovery` claims for the current durable interrupted
  execution. A valid replacement may continue already-admitted work through
  closed namespace and group scopes, retains the interrupted run-request
  generation, and leaves newer requested work pending; and
- harden opaque group identity storage so inherited object keys cannot satisfy
  admission and prototype-named keys round-trip as owned durable data.

The heartbeat guide also documents the intended scale-out path: keep Heddle's
portable claim, fencing, recovery, and conformance semantics while a host owns
queueing, leases, topology, desired lifecycle, and product preparation.

## Upgrade note

This is a major release because `HeartbeatTaskClaimResult`,
`HeartbeatTaskExecutionResult`, and `RunHeartbeatTaskResult` gain the public
`admission-closed` discriminant, and `HeartbeatTaskClaimMode` gains
`recovery`. Exhaustive TypeScript consumers must handle the new variants.

Custom `HeartbeatTaskStore` adapters must serialize admission changes with
claims and atomically match and consume an exact recovery marker. Stale IDs,
already-consumed markers, and legacy diagnostic recovery records cannot
authorize a bypass. The public state projector and executable adapter
conformance suite cover these transitions.

The conformance harness keeps `createAdmissionControl` optional for source
compatibility. Supplying it is required to certify scoped admission; omitting
it covers only the legacy namespace-only contract.

Existing task records need no migration when they do not set
`admissionGroupId`. Hosts assigning a group must initialize its durable
decision before expecting work to claim. Closing admission blocks fresh
logical work but does not cancel active work or prevent an exact recovery
continuation; use explicit pause, drain, or cancellation when no execution may
proceed.

## Verification

The release candidate is verified with the full repository build and test
suite, Runtime package packing, packed-artifact inspection, and a clean
consumer install/import check.
