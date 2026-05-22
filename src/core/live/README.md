# Live Activity

`src/core/live` owns the shared user-facing live event contract consumed by TUI,
web, control-plane transports, and programmatic hosts.

Runtime and compaction events should be emitted directly as
`ConversationActivity` values. Trace events are durable observability evidence,
not a user-facing event source. When one origin needs both trace and activity,
emit both at that origin with the same canonical event name from
`src/core/event-types.ts`.

Do not add parallel callback lanes or mapper layers for assistant streaming,
tool progress, run lifecycle, or compaction progress. Add structured fields to
the activity type that owns the behavior, then let interfaces decide how to
present those fields.
