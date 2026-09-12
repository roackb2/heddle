# `@heddleagent/runtime` 9.0.0

This release candidate adds a portable read-only memory composition for agent
and heartbeat runs, plus an explicit mutation receipt for host checkpoint
policy.

## What changed

- Export `MemoryToolMode` with a new `read-only` value.
- Export `memoryToolkit` for explicit composition with
  `includeDefaultTools: false`. Read-only mode creates exactly the memory list,
  read, and search tools.
- Add `RunAgentLoopOptions.memoryMode` and carry the mode through direct
  heartbeat and execution-context agent invocation.
- Require `AgentHeartbeatResult.memory.changed` on current results. Conversation
  turns and heartbeat runs now share the same trace projector for Heddle-owned
  memory mutations.
- Decode historical persisted heartbeat results that do not contain the new
  receipt as `{ changed: false }`.

## Host lifecycle boundary

The receipt reports whether a settled Heddle memory tool changed the portable
memory working copy. Candidate recording and successful direct note editing
report `true`; memory reads, explicit checkpoint skips, and failed writes report
`false`. It does not detect product-tool, shell, or arbitrary filesystem writes.

A hosted adapter still owns authenticated memory scope selection, restore before
agent invocation, signed capability allowlisting, checkpoint after successful
settlement, durable retry/conflict handling, and retention. Heddle does not
select product identities or storage keys and does not serialize tool functions
or filesystem paths through the heartbeat execution transport.

## Upgrade notes

- Code that constructs an `AgentHeartbeatResult` must now include
  `memory: { changed: boolean }`.
- Persisted heartbeat records require no migration; the schema supplies the
  conservative `false` default when the field is absent.
- `read-and-record` remains the default for the ordinary default tool bundle.
  Select `read-only` explicitly for inspection-only runs.

## Verification

The candidate is covered by exact read-only toolkit composition, heartbeat
changed/unchanged receipts, historical schema decoding, conversation receipt
regressions, typechecking, lint, the full unit/integration baseline, and Runtime
package build/pack/consumer-import checks.

This file and the package version describe a reviewable release candidate only.
Merge, tag, GitHub release creation, npm publication, deployment, and observed
adopter behavior remain separate operator-controlled states.
