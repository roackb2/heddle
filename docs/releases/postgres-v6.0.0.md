# Heddle PostgreSQL Adapters v6.0.0

This is the first stable release of `@heddleagent/postgres`. It establishes the
technology-specific adapter family without pretending that every Heddle state
surface belongs in one database.

Install the first supported adapter with its owning domain contract:

```bash
npm install @heddleagent/postgres @heddleagent/execution-host-client drizzle-orm pg
```

## What ships

- `@heddleagent/postgres/execution-host/conversations` implements the public
  `HostedConversationTurnLifecycleStore`;
- `heddle.execution_host_conversation_turns` stores only the safe lifecycle
  projection and denormalized scope fences;
- ordered adopter-run SQL migrations ship with the package;
- exact-repeat idempotency, wrong-scope rejection, conflicting/late transition
  rejection, pre-acceptance failure, and scoped expiry are atomic;
- database constraints enforce the closed statuses/failure codes and valid
  lifecycle row shapes; and
- the canonical lifecycle conformance runs against real PostgreSQL and
  independent pools.

The release does not include a generic root provider, pool construction,
runtime migration execution, product history/query/retention, active-run
recovery, conversation-session adapters, or the heartbeat adapter migration.

## Verification and publication

The release gate verifies:

- the exact manifest, export, dependency, migration, and tarball allowlists;
- JavaScript loading and strict TypeScript consumption from a fresh install;
- the real-PostgreSQL conformance and concurrent fencing tests;
- the immutable npm integrity and `latest -> 6.0.0` channel;
- an annotated `postgres-v6.0.0` tag and normal GitHub release; and
- continued availability of the legacy v5 PostgreSQL package.

Publication uses the exact verified tarball. The npm package's trusted
publisher is restricted to `roackb2/heddle`, `publish-packages.yml`, the
`npm-release` environment, and protected `main`. npm can attach that publisher
only after the new coordinate exists, so this first coordinate may require one
operator-authenticated bootstrap publication from the tagged, clean main
commit. Configure the trusted publisher immediately afterward and rerun the
same workflow commit; subsequent immutable versions publish automatically on
merge.

Do not manually republish after a successful workflow. A recovery rerun must
verify the already-published integrity and fresh consumers without mutating the
immutable version.
