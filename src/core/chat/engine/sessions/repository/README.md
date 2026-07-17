# Chat Session Repository

This folder owns the async persistence port for durable chat sessions and its
default file-backed JSON adapter. Session behavior stays in the parent session
service; adapters only own durable record I/O.

## Owns

- the `ChatSessionRepository` async adapter contract
- optimistic revisions and compare-and-swap mutation errors
- deterministic, cursor-paginated catalog reads
- database-neutral strict record validation and catalog projection through
  `ChatSessionPersistenceCodec`
- canonical in-process ordering, opaque cursors, and page validation through
  `ChatSessionCatalogPagination`
- the runner-neutral `ChatSessionRepositoryConformance` suite used to certify
  host adapters against the shared behavioral contract
- the default catalog and immutable per-session revision file layout
- persisted JSON contract in `chat-session-schemas.ts`
- legacy file serialization/deserialization behavior through the private
  `ChatSessionCodec`
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
- remote adapters should parse opaque records and project catalog columns with
  `ChatSessionPersistenceCodec`; do not copy Heddle's record shape into another
  hand-maintained validator
- adapters should use `ChatSessionCatalogPagination` for cursor wire behavior
  and mirror its documented order exactly in database queries
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

The authoring primitives deliberately do not own SQL, transactions, connection
pooling, migrations, identity, tenant filters, RLS, or database error codes.
Those stay in the host adapter. `ChatSessionPersistenceCodec.parseRecord(...)`
throws on malformed complete records instead of using the tolerant legacy-file
read behavior; catch that failure only to add storage-specific context, never
to return a partial conversation.

The session service retries a small, bounded number of optimistic update
conflicts by rereading the latest record and reapplying the update. A generic
session updater must therefore be free of external side effects. Delete remains
strict: a concurrent change is surfaced instead of deleting newer data.

## Adapter Conformance Suite

`ChatSessionRepositoryConformance.createScenarios(harness)` returns named async
callbacks that can be registered with Vitest, Node's test runner, Jest, or
another host runner. `runAll(harness)` runs the same scenarios sequentially for
scripts and smoke checks. The harness owns only three integration points:

- create a new repository instance already bound to an opaque generated scope;
- clean every record/resource for that scope; and
- deliberately corrupt one addressable record for the negative-path check.

The suite checks exact CRUD revisions, concurrent unique-create and CAS races,
stable cursor pages including binary UTF-8 ties, filters before page boundaries,
identical-ID isolation across two scopes, complete reopen through fresh adapter
instances, corruption propagation, and invalid page limits. It invokes cleanup
for every generated scope even when the adapter or an assertion fails.

Passing this suite certifies the Heddle repository behavior exercised by the
scenarios. It does not certify product authentication, RLS policy, migrations,
query plans, connection pooling, load behavior, process-kill recovery, backups,
or disaster recovery. Scope isolation proves only that the host-provided
scope-bound factories do not cross records. The corruption hook is intentionally
test-only and must not be exposed by production adapter APIs.

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

For cursor pages, decode/encode with `ChatSessionCatalogPagination` and use a
composite database predicate matching its query order (pinned first, then
`updatedAt` descending, then ID ascending). Make the final ID comparison use a
stable binary/C collation. The helper's comparator is for in-process adapters
and tests; a database adapter must express the same order in SQL rather than
loading and rewriting the whole collection.
