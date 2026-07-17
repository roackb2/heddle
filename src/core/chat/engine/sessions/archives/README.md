# Conversation Archive Repository

This folder owns durable storage for compacted conversation history. It is a
separate boundary from active `ChatSessionRepository` records, generated
artifacts, traces, and memory.

## Contract

`ChatArchiveRepository` is async and host-injectable. It loads the manifest,
reads the current rolling summary, and atomically appends one archive unit:
exact messages, summary text, and the next manifest. A successful append must
never return a manifest whose locators cannot be read.

The legacy `path` and `summaryPath` field names are retained for stored-session
compatibility. Treat their values as repository-owned opaque locators. The
default file adapter returns `.heddle/...` paths; a database/blob adapter can
return stable keys meaningful only to that adapter.

## Ownership boundary

Heddle owns archive record semantics, manifest validation, compaction ordering,
and the default local file implementation. A host adapter owns its connection
lifecycle, authenticated tenant/session scope, transaction, schema, retention,
backup, and restore.

The host must bind `ChatSessionRepository` and `ChatArchiveRepository` to the
same authenticated identity scope. Heddle intentionally does not accept a user
or tenant id on individual archive operations; trusting caller-provided scope
would weaken the storage boundary.

## File adapter durability

`FileChatArchiveRepository` preserves the v1 layout under
`.heddle/chat-sessions/<session-id>/archives`. It writes immutable content files
before atomically replacing the manifest and serializes appends with
`proper-lockfile`. A crash may leave unreferenced orphan content, but readers
will see either the previous complete manifest or the next complete manifest.
Malformed or session-mismatched manifests raise
`ChatArchiveStorageCorruptionError`; they are never treated as empty history.
During compaction, adapter exceptions are surfaced as
`ChatArchiveRepositoryError` with the operation and original `cause` intact so
hosts can log database details without interpreting a false success.

## Deliberate limits

- This port does not define SQL tables, an ORM, or object-store credentials.
- It does not make traces, memory, or generated artifacts durable.
- It does not add a model-visible raw-archive reader. Remote hosts that need
  exact retrieval should expose a scoped host tool backed by their repository.
- Active-run and streaming coordination remain process-local.
