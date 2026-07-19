# Stage 06: choose a conversation persistence posture

Stage 06 is one customization layer with alternative storage topologies. It is
not a sequence where PostgreSQL depends on local JSON. Choose the posture that
matches the host the product already operates.

| Host posture | Start with | Heddle provides | Host still owns |
| --- | --- | --- | --- |
| One process or one durable server with a persistent volume | [`local-json`](local-json) | Paired default session/archive repositories and complete state-root recovery | Volume access, backup/restore, capacity, retention, and single-writer operation |
| A hosted service that already operates PostgreSQL | [`postgres-drizzle`](postgres-drizzle) | Repository contracts, codecs, readiness reporting, and conformance primitives | Trusted scope, adapter code, migrations, pooling, database operations, and replica routing |

Both postures persist completed conversation sessions and compacted archives.
Neither promises durable in-flight execution, approval recovery, cancellation,
or SSE replay after an executor is lost.

The local JSON example verifies the zero-adapter path built into Heddle. The
PostgreSQL + Drizzle reference demonstrates how a host implements Heddle's
conversation persistence capability over shared infrastructure. It remains
host-owned reference code rather than an official database adapter package.

Persistence is independent of transport and presentation. Either posture can
be combined with the [Stage 05 hosted-agent layers](../05-hosted-agent/README.md)
or with a product's existing server, transport, and UI stack.
