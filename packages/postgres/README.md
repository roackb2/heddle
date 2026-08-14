# `@heddleagent/postgres`

Status: **private package foundation; not published or installable**

This package will provide official PostgreSQL implementations for selected,
public, Heddle-owned durable ports. It replaces the heartbeat-only product
description of `@roackb2/heddle-postgres`; it is not a universal product
database or key-value abstraction.

## Ownership

Heddle owns each reusable port's state machine, schema it ships, ordered
migrations, adapter correctness, fencing, and real-database conformance. The
adopter owns its PostgreSQL service and credentials, pool lifecycle,
production migration execution, tenant derivation, backups, encryption,
availability, retention choices, and product-specific tables and queries.

Adapters will accept a supported adopter-managed pool or database handle. They
will never start a database, automatically run migrations at application
startup, or infer trusted identity from caller input.

## v6 durability inventory and launch posture

The live [durable-state inventory](../../docs/architecture/durable-state.md)
and [adopter support matrix](../../docs/guides/programmatic/durability-support.md)
govern this list.

| Heddle-owned surface | Current contract posture | v6 PostgreSQL posture |
| --- | --- | --- |
| Conversation sessions | Async, revision-fenced, remote-ready `ChatSessionRepository` with conformance | **Launch target**, paired with archives under one authenticated scope |
| Conversation compaction archives | Async, atomic-append, remote-ready `ChatArchiveRepository` with conformance | **Launch target**, paired with sessions |
| Heartbeat task authority, checkpoints, and run records | Async claim/fencing/recovery store with an existing PostgreSQL implementation and conformance | **Launch target**, migrated without weakening existing guarantees |
| Separate Execution Host conversation lifecycle | Generic requested/running/terminal lifecycle requires an atomic, scope-fenced store | **Launch target after its public port and conformance contract land** |
| Standalone one-off heartbeat checkpoint | Async host-replaceable `HeartbeatCheckpointStore`, scoped by adapter instance | **Excluded from launch**; scheduled durability belongs to `HeartbeatTaskStore`, and v6 will not invent a global checkpoint identity |
| Result artifacts | Synchronous, local-biased repository without atomic metadata/content commit | **Deferred** until its owning domain defines a remote-ready contract |
| MCP config/catalog and skill activation | Synchronous stores containing workspace-local configuration, cache, consent, or source paths | **Excluded** from the v6 launch matrix |
| Provider credentials, browser profiles, workspace/daemon catalogs | Machine-local secrets, sessions, paths, and process facts | **Excluded**; generic PostgreSQL migration would violate their ownership |
| Active runs, replay buffers, approvals, and subscribers | Process-local coordination with no durable execution port | **Excluded** until a separately selected durable-execution design exists |
| Product history, billing, analytics, user relationships, and UI projections | Product-owned data and policy | **Excluded** permanently from this package |

The first public version must expose domain-specific entrypoints and an exact
implemented support matrix. Its root must not imply that every row above is
available. Every launch adapter requires reviewed migrations, isolation and
fencing tests, real-PostgreSQL conformance, and restart/recovery evidence.

The machine-readable
[`durable-port-support.json`](durable-port-support.json) records the exact
launch-required and excluded state surfaces. `yarn package-family:verify`
rejects missing, duplicated, or silently reclassified rows.

The current official implementation remains in
`@roackb2/heddle-postgres` and covers heartbeat only. Activate this package
only after its domain-specific entrypoints, dependency direction, migrations,
and real-store conformance exist for every launch-required row; do not expose a
generic root provider first. See the [package-family boundary](../README.md)
before changing this status.
