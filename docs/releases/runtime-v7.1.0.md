# `@heddleagent/runtime` 7.1.0

This release adds provider-neutral durable working-set checkpoints and a
pre-terminal heartbeat result projection boundary for hosted agents that need
to preserve work before reporting success.

## What changed

- add shared `PortableDirectoryCheckpointPolicy` and
  `PortableDirectoryCheckpointService` primitives for deterministic capture,
  integrity validation, explicit file and byte limits, symbolic-link rejection,
  and staged restore into an absent or empty directory;
- preserve the existing memory-v1 schemas, serialized bytes, errors, and
  effective limits while moving its filesystem mechanics onto the shared
  portable-directory boundary;
- add the separate `WorkingSetCheckpointService`, opaque
  `WorkingSetScopeId`, versioned generation and manifest codecs, and
  `WorkingSetCheckpointStore` compare-and-swap contract;
- require every working-set service to receive explicit `maxFileCount`,
  `maxFileBytes`, and `maxTotalBytes` values plus a privileged
  `resetLocalWorkingCopy` callback bound to its dedicated disposable root; and
- let `HeartbeatRunService.start()` accept an optional typed `projectResult`
  callback. Heddle awaits that callback before resolving the result promise or
  publishing the successful result terminal; projection failures publish only
  the bounded heartbeat error terminal.

All new Runtime APIs are available from `@heddleagent/runtime/advanced`.

## Upgrade and lifecycle notes

This is an additive minor release. Existing heartbeat callers without a
projector and existing memory checkpoint stores require no migration.

A host adopting working-set checkpoints must derive scope only from verified,
stable identity, authorize that scope in its store adapter, persist immutable
generations before atomically advancing the manifest, and reconcile ambiguous
commit responses against authoritative state. Restore must complete before
filesystem or MCP tools can access the working root. Checkpoint projection must
complete before a successful conversation or heartbeat terminal is exposed.

The working root is a dedicated disposable copy, not a general workspace or
home-directory backup. Heddle intentionally provides no hidden size defaults,
object-store adapter, scheduler wiring, or exactly-once guarantee for external
effects. The host owns reset authority, lifecycle composition, retention,
observability, and idempotent effect reconciliation.

## Verification

The release candidate is verified with the full repository build and test
suite, focused portable-directory, memory-compatibility, working-set, and
heartbeat projection coverage, Runtime package inspection, and a clean
consumer install/import check.
