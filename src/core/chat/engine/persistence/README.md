# Persistence Capability Composition

This service boundary composes Heddle-owned persistence domains without
pretending that they share one storage contract.

## Ownership

- A domain capability groups ports that must be configured and reasoned about
  together for one user-facing promise.
- `ConversationPersistence` groups the revisioned session repository and the
  append-only compaction archive repository. Heddle owns their domain semantics
  and default local implementations.
- A host owns authenticated scope, database transactions, schema/migrations,
  retention, backup/restore, and any canonical product result.

`HeddlePersistenceCapabilities` is a discoverable composition map. It is not a
universal CRUD interface. Future artifact, trace, or other capabilities must
retain their own identities, consistency, data-size, retention, and security
semantics.

## Readiness boundary

`ConversationPersistenceService.assess(...)` reports whether the Heddle
conversation boundary is configured completely and returns the small set of
host checks needed to support the selected durability level. It does not run
database writes and does not certify authentication, deployment topology,
backups, or disaster recovery.

Add another automated readiness scenario only when a real adapter exposes a
portable correctness risk or a public support claim needs that evidence. Keep
provider-specific load, migration, RLS, and recovery tests with the maintained
binding or host service.

## Compatibility

Heddle 5.1's separate `sessionRepository` and `archiveRepository` engine options
remain as deprecated compatibility inputs. New hosts should configure
`persistence.conversations`; the capability form requires both repositories and
cannot be mixed with the older options. A legacy partial configuration remains
operational for compatibility but readiness reports it as incomplete for a
completed-conversation durability promise.
