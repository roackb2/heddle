# Memory Checkpoints

This module owns the portable, memory-only recovery boundary for a Heddle
memory working copy. A host may persist the checkpoint through S3, another
object store, or a purpose-built implementation of `MemoryCheckpointStore`.
The provider does not redefine Heddle's file selection, encoding, validation,
or restore semantics.

The filesystem mechanics delegate to
[`src/core/checkpoint/portable-directory`](../../checkpoint/portable-directory/README.md).
Memory keeps its released v1 scope, generation, manifest, store, error, and
serialized-byte contracts. Its compatibility policy does not add new default
file-count or byte rejection; future bounded directory domains must select
their own explicit operational limits.

## Owns

- A versioned generation and committed-manifest schema.
- Deterministic capture of portable memory files.
- Per-file and whole-generation integrity checks.
- Restore-before-use into an absent or empty memory root.
- Manifest compare-and-swap expectations for concurrent writers.
- Explicit deletion of the authoritative manifest.

The shared portable-directory service owns canonical relative paths, regular
file integrity envelopes, symlink rejection, bounded reads, and staged local
restore. It does not own memory's allowlist or durable generation semantics.

## Portable Files

A checkpoint contains:

- Markdown catalogs and notes outside `_maintenance/`;
- `_maintenance/candidates.jsonl`;
- `_maintenance/runs.jsonl`.

It deliberately excludes maintenance locks, credentials, project
configuration, approval policy, MCP configuration, browser profiles, trace
output, and every other non-memory file. Symbolic links inside the memory root
fail capture instead of being followed.

## Lifecycle

1. Derive and authorize a stable `MemoryScopeId` from verified product
   identity.
2. Before bootstrapping or reading a fresh local working copy, call
   `restore(scopeId)`.
3. Let the memory domain use the restored local files normally.
4. After a memory-changing interaction or maintenance transaction reaches a
   stable boundary, call `checkpoint(scopeId)`.
5. A shutdown checkpoint may reduce recent loss, but must not be the only
   checkpoint trigger.

Conversation turns report `result.memory.changed` from Heddle-owned memory
events. Hosted callers should combine that fact with their own terminal-outcome
policy instead of interpreting Heddle tool names or tool-result payloads. The
turn's returned promise resolves only after configured post-turn maintenance
reaches a stable boundary. In `background` mode, the assistant response may
still stream first; only result settlement waits for maintenance.

`restore()` never merges with or overwrites existing files. The caller must
serialize bootstrap, restore, and first use for one working copy. It must also
serialize `checkpoint()` with memory mutations so capture observes one stable
domain state rather than an in-progress file transaction.

## Store Contract

`MemoryCheckpointStore.commit()` makes the immutable generation durable first,
then atomically advances the scope's authoritative manifest only when it still
points at `expectedGenerationId`. A competing change raises
`MemoryCheckpointConflictError`. This compare-and-swap boundary prevents an
older host from silently replacing newer memory.

The store may retain unreferenced immutable generations for recovery or delete
them according to its documented retention policy. `delete()` must atomically
remove the manifest only when it still names the expected generation; orphan
cleanup remains an adapter concern.

## Does Not Own

- An S3 client or any other provider SDK.
- Periodic scheduling or process shutdown hooks.
- Runtime-session lifecycle and AgentCore integration.
- General workspace backup or synchronization.
- Configuration, approval, MCP, telemetry, artifact, or conversation storage.
