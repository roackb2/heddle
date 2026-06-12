# cli-v2 Notifications

This service folder owns terminal desktop notification delivery for cli-v2.

## Boundary

- `src/client-shared/services/notifications` projects notification intents from
  shared control-plane events.
- `ControlPlaneTerminalNotificationService` delivers those intents through
  `node-notifier`, sends a terminal attention signal, and suppresses duplicates
  for one terminal session.
- cli-v2 state reducers decide when to pass received event facts to the shared
  projection service.

Do not put approval policy, task state transitions, or event vocabulary here.
Those remain owned by `src/core/approvals`, `src/core/live`, and
`src/core/heartbeat`.
