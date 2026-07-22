# Client-Shared Notifications

This domain projects existing control-plane events into notification intents
that web-v2 and cli-v2 can deliver through their own host mechanisms.

## Boundary

- `src/core/live` and `src/core/heartbeat` own the event facts.
- `src/client-shared/services/notifications` owns the shared decision that an
  existing event should become a user-facing notification.
- `src/web-v2` owns browser Notification API delivery and toast fallback.
- `src/cli-v2` owns desktop/terminal notification delivery.

Do not add browser APIs, OS notification packages, terminal escape behavior, or
settings persistence here. If an event does not carry enough data for a
notification, extend the owning event contract instead of enriching it in a host
adapter.

## Current Intents

- `tool.approval_requested` becomes an approval-required notification.
- `loop.finished` becomes a session run-finished notification.
- `heartbeat.task.finished` and `heartbeat.task.failed` become task-run
  notifications for the active workspace while a client is open.

Session-completion bodies are short, whitespace-normalized previews. The full
assistant result remains in the conversation and must not be copied into a
notification intent, because browser and desktop notification surfaces are
space-constrained and may appear outside the Heddle window.

Each projected intent has a stable `key`. Hosts should pass intents through
`ClientSharedNotificationMemory` before delivery so reconnects and refetches do
not notify repeatedly for the same event.
