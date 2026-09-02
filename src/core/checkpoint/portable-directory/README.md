# Portable Directory Checkpoints

This module owns reusable local-filesystem mechanics for capturing and
restoring one explicitly selected directory. It lets durable domains share the
same path, symlink, integrity, resource-limit, and staged-restore guarantees
without pretending that they share one scope, manifest, store, or lifecycle.

## Owns

- Canonical POSIX-style relative file paths that cannot traverse the selected
  root or become absolute on Windows.
- A base64, byte-length, and SHA-256 integrity envelope for regular files.
- An immutable `PortableDirectoryCheckpointPolicy` with an inclusion predicate
  and explicit file-count, per-file byte, and total-byte limits.
- Deterministic, bounded capture that rejects symbolic links and selected
  non-regular files.
- Pure validation of every persisted file against the exact selection,
  integrity, path-conflict, and resource policy before a destination is
  touched.
- Restore through a sibling staging directory followed by one rename into an
  absent or empty destination.

## Does Not Own

- Durable identity, scope derivation, generation or manifest schemas.
- Object-store keys, compare-and-swap, retention, or ambiguous-write recovery.
- When a conversation, heartbeat, or other workflow restores or checkpoints.
- Whether failed or cancelled executions should retain local changes.
- Product file conventions or a general workspace backup.

Those decisions belong to the domain specialization and its host lifecycle.
For example, memory retains its released v1 generation, manifest, scope, store,
and error contracts while delegating directory mechanics here. A future
working-set specialization must define its own identity and durable store.

## Policy Example

```ts
import {
  PortableDirectoryCheckpointPolicy,
  PortableDirectoryCheckpointService,
} from '@heddleagent/runtime/advanced';

const policy = new PortableDirectoryCheckpointPolicy({
  includeFile: () => true,
  limits: {
    maxFileCount: 128,
    maxFileBytes: 1024 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  },
});

const directory = new PortableDirectoryCheckpointService('/workspace/state', policy);
const files = await directory.capture();
await directory.restore(files);
```

The example limits are illustrative, not framework defaults. Every
specialization must choose and document limits appropriate to its payload and
storage path. The caller must serialize capture/restore with mutations of the
same local working copy. Byte limits apply to decoded file content; generation
metadata and transport encoding remain the specialization's responsibility.

Unsafe paths are rejected by default. The policy's `unsafePathBehavior:
'exclude'` mode exists for already-versioned domains whose released capture
behavior skipped such names; new domains should retain the fail-closed default.

## Restore Safety

`restore()` accepts only an absent or empty destination and never merges files.
It validates paths, inclusion, duplicates, ancestor conflicts, limits, base64,
lengths, and checksums before creating the staging directory. Files are written
with exclusive creation and mode `0600`, synchronized, and only then exposed by
renaming the complete staged directory.

Capture opens files with `O_NOFOLLOW` where Node exposes it. Windows does not
provide that POSIX flag, so the service also compares the immediately preceding
`lstat` identity with the opened handle's `fstat` identity. This fallback keeps
the public contract cross-platform while still failing closed when the selected
leaf changes or resolves as a symbolic link.

This is a local filesystem publication boundary, not distributed transaction
or execution fencing. A durable specialization still needs an immutable
generation plus an authoritative manifest compare-and-swap so a failed capture
or competing writer cannot replace the last committed generation.
