# `@roackb2/heddle-postgres`

`@roackb2/heddle-postgres` provides Heddle's durable PostgreSQL heartbeat task
authority. It owns the transactional details that an adopter should not need to
reimplement: row locking, due-task claims, execution fencing, lease-backed
recovery, checkpoint settlement, run history, and atomic operator controls.

```bash
npm install @roackb2/heddle @roackb2/heddle-postgres drizzle-orm pg
```

The package is optional. Installing Heddle does not install a database driver or
make PostgreSQL part of the local-first runtime.

## Boundary

The package owns:

- the `heddle.heartbeat_tasks` and `heddle.heartbeat_run_records` schema;
- Heddle task transitions applied under PostgreSQL row locks;
- claim identity and stale-writer fencing;
- fixed execution leases and explicit expired-lease recovery;
- durable checkpoints and run records;
- atomic create, reconcile, update, enable, resume, trigger, and delete controls.

The adopter owns:

- the PostgreSQL service, connection pool, backups, encryption, and availability;
- applying the bundled SQL through its normal migration workflow;
- deriving `namespace` from trusted product or deployment authority;
- task-to-worker routing, notifications, polling, and worker lifecycle;
- idempotency for product side effects performed by a task handler;
- choosing an execution lease longer than every bounded worker attempt.

The package does not start a timer, subscribe to a queue, open a database
connection, run migrations at startup, or authorize a caller.

## Compose the authority

Inject an existing Drizzle PostgreSQL database. Both `node-postgres` and
`postgres.js` Drizzle databases satisfy the public driver-neutral type.

```ts
import { createPostgresHeartbeatTaskAuthority } from '@roackb2/heddle-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const database = drizzle(pool)

const heartbeat = createPostgresHeartbeatTaskAuthority({
  database,
  namespace: authenticatedTenant.id,
  executionLeaseMs: 20 * 60_000,
})

// Give workers only execution capabilities.
const taskStore = heartbeat.store

// Give trusted operator routes only administration capabilities.
const taskAdministration = heartbeat.administration
```

The two returned objects deliberately expose different interfaces. Do not pass
the administration port into an execution worker merely because both use the
same database.

`namespace` is a durable row-identity and isolation boundary, not an
authentication mechanism. Resolve it from an authenticated product identity or
fixed deployment configuration; never accept a model-provided or unchecked
request value as the namespace.

## Migration ownership

The package ships one portable baseline SQL file and exports its URL:

```ts
import { heartbeatPostgresMigrationSqlUrl } from '@roackb2/heddle-postgres'
```

Adopt that SQL into the application's existing migration system. Runtime
composition never applies it automatically.

Choose exactly one migration owner. If an application already owns compatible
`heddle.heartbeat_tasks` and `heddle.heartbeat_run_records` tables—such as an
earlier Lucid deployment—keep its existing migration history and do not apply
the bundled baseline again. New applications may copy or execute the bundled
baseline as their initial authority migration.

Schema changes must be rolled out before deploying code that requires them.
Do not grant a normal worker role schema-mutation privileges.

## Lease and delivery semantics

`executionLeaseMs` is fixed when a task is claimed. The current Heddle store
contract does not renew a lease during execution, so configure it above the
maximum permitted duration of one worker attempt. Recovery only considers rows
whose lease has actually expired; an owner mismatch alone never permits a
claim to be stolen.

Durable run requests are the source of truth. A queue notification or an
in-process wake signal is only a latency optimization, and a bounded poll remains
the correctness fallback. Duplicate delivery is safe at the Heddle claim and
settlement boundary, but external side effects still need product-level
idempotency.

## Certification

The package is tested through Heddle's canonical targeted-store conformance
suite using two independent PostgreSQL pools, plus administration and race
coverage. To run the real database suite against a disposable database whose
baseline migration is already applied:

```bash
HEDDLE_POSTGRES_TEST_URL=postgresql:///heddle_test yarn postgres:test
```

The suite creates only random namespaces and removes their rows afterward. It
does not create or drop the database or schema.
