# `@heddleagent/postgres`

Status: **private package foundation; not published or installable**

This package will provide official PostgreSQL implementations for selected,
public, Heddle-owned domain persistence ports. It replaces the heartbeat-only
product description of `@roackb2/heddle-postgres`; it is not Heddle's universal
persistence package, a product database, or a key-value abstraction.

## Ownership

Each domain package owns its purpose-named, technology-neutral port, state
machine, invariants, persistence codec, and adapter-agnostic conformance.
`@heddleagent/postgres` owns concrete PostgreSQL implementations, their SQL
schema and ordered migrations, transaction/isolation/fencing behavior, and
real-PostgreSQL conformance. The adopter owns its PostgreSQL service and
credentials, pool lifecycle, production migration execution, tenant
derivation, backups, encryption, availability, retention choices, and
product-specific tables and queries.

Adapters will accept a supported adopter-managed pool or database handle. They
will never start a database, automatically run migrations at application
startup, or infer trusted identity from caller input.

Planned entrypoints are purpose-qualified beneath the technology package:

- `@heddleagent/postgres/conversations`;
- `@heddleagent/postgres/heartbeat`; and
- `@heddleagent/postgres/execution-host/conversations`.

The exact exports remain unimplemented in this foundation. Domain packages do
not depend on PostgreSQL; this adapter package depends one-way on the contracts
it implements.

## What PostgreSQL does not cover

Heddle durability also includes immutable content, workspace continuity,
memory, telemetry, secrets, and process coordination. They do not become
PostgreSQL responsibilities merely because a database can retain bytes:

- large archive content, artifacts, uploads, or selected checkpoints may use an
  object-store adapter after their domains expose stable ports;
- an ephemeral Execution Host may use a provider-managed session filesystem as
  a continuity working copy, while canonical records and selected portable
  checkpoints survive provider expiry separately;
- logs, traces, metrics, and audit events belong in observability/audit sinks;
- credentials and machine facts remain outside generic persistence; and
- active execution needs a workflow/queue design, not another table adapter.

For a hybrid archive, immutable content is written before the authoritative SQL
manifest/reference commits. A failed SQL commit may leave an orphan object, but
the database must never publish a reference to missing content. The PostgreSQL
package may coordinate that domain operation through an injected purpose-named
content port; it must not import an S3 implementation or make S3 part of the
conversation contract.

## Activation boundary

The live [durable-state inventory](../../docs/architecture/durable-state.md)
and [adopter support matrix](../../docs/guides/programmatic/durability-support.md)
describe Heddle's released persistence behavior. This private foundation does
not change those support claims.

The first public version must expose only implemented domain-specific
entrypoints. Each exported adapter requires reviewed migrations, isolation and
fencing tests, real-PostgreSQL conformance, restart/recovery evidence, and a
README support table that matches the shipped exports. Mentioning a possible
domain here does not make its adapter available.

The current official implementation remains in
`@roackb2/heddle-postgres` and covers heartbeat only. Activate this package
only after its domain-specific entrypoints, dependency direction, migrations,
and real-store conformance exist for every exported domain; do not expose a
generic root provider first. See the [package-family boundary](../README.md)
before changing this status.
