# Conversation Turn Lease Renewal

This folder owns lease liveness while one persisted conversation turn is in
flight.

## Owns

- Starting renewal immediately after preflight acquires a fenced session lease.
- Refreshing that lease on a wall-clock interval, independent of model,
  activity, or tool events.
- Aborting the turn's runtime signal when the lease can no longer be refreshed,
  including when another owner has taken it.
- Deterministic shutdown that waits for an in-flight refresh before the turn
  releases its lease.

## Does Not Own

- Lease acquisition, conflict policy, fencing tokens, or release. Those remain
  in `sessions/leases/` and the session service.
- Host run coordination, replay, approvals, or cancellation. Those remain in
  `core/chat/runs/`.
- Retry or recovery of completed model/tool work after ownership is lost.

Engine turns always own this renewal lifecycle. Hosts must not add a second
session-lease heartbeat around `engine.turns.submit()` or
`engine.turns.continue()`. Host-owned heartbeats remain valid for operations
that acquire a lease outside the turn engine, such as direct shell and explicit
compaction.
