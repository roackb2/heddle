# Chat Session Repository

This folder owns the async persistence port for durable chat sessions and its
default file-backed JSON adapter. Session behavior stays in the parent session
service; adapters only own durable record I/O.

## Owns

- the `ChatSessionRepository` async adapter contract
- optimistic revisions and compare-and-swap mutation errors
- deterministic, cursor-paginated catalog reads
- the default catalog and immutable per-session revision file layout
- persisted JSON contract in `chat-session-schemas.ts`
- serialization/deserialization behavior through `ChatSessionCodec`
- legacy revision-one file compatibility

## Does Not Own

- session behavior or policy
- host/UI flow
- product identity, authorization, or tenant-to-workspace mapping
- default/fallback resolution beyond what is required to deserialize old data
- garbage collection of unreferenced immutable revisions

## Boundary

- session services depend on `ChatSessionRepository` and instantiate
  `FileChatSessionRepository` only as the local default
- hosts should not call it directly when a core session service can own the flow
- disk-shape validation belongs in `chat-session-schemas.ts`, not in ad hoc
  repository type guards
- do not add wrapper-only repository files; this folder earns its place by
  owning real file persistence mechanics

## Adapter Contract

Every adapter must:

- implement async `list`, `read`, `create`, `update`, and `delete` operations;
- return a monotonically increasing revision with every stored record;
- create only when the session ID is absent;
- update and delete only when `expectedRevision` matches the stored revision;
- throw the exported already-exists/revision-conflict errors rather than hide a
  failed compare-and-swap;
- paginate in a stable order and apply exactly the same order to its cursor
  predicate, so page boundaries cannot skip or repeat records;
- scope all operations to the authenticated product boundary chosen by the
  host. Heddle's record does not invent product-specific account or RLS fields.

The session service retries a small, bounded number of optimistic update
conflicts by rereading the latest record and reapplying the update. A generic
session updater must therefore be free of external side effects. Delete remains
strict: a concurrent change is surfaced instead of deleting newer data.

## Default JSON Layout

Given `chat-sessions.catalog.json`, the file adapter stores:

```text
chat-sessions.catalog.json
chat-sessions/
  <session-id>.1.json
  <session-id>.2.json
  ...
```

The body for a new revision is written before an atomic catalog replacement
points at it. Reads do not need the write lock because catalog replacement is
atomic and referenced bodies are immutable. `proper-lockfile` serializes
writes across processes, while `async-mutex` serializes operations within one
adapter instance.

Old `<session-id>.json` bodies are accepted only as revision one. New writes
always use revisioned files. Superseded or interrupted revision files are kept
for now; safe compaction/garbage collection is a separate lifecycle concern.

## Database Adapter Notes

A relational adapter should keep the full `ChatSession` as JSON/JSONB plus
indexed catalog columns (`id`, scope/workspace, pinned, archive state,
`updatedAt`, and `revision`). Perform update/delete compare-and-swap in the
database itself, for example with `WHERE id = ? AND revision = ?`, incrementing
the revision in the same statement or transaction. If no row is changed,
distinguish a missing record from a revision conflict and return/throw the
contract result accordingly.

For cursor pages, use a composite cursor matching the query order (pinned
first, then `updatedAt` descending, then ID ascending) and make the final ID
comparison use a stable binary/C collation. Do not load and rewrite the whole
collection for one record mutation.
