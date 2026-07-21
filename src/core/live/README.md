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

## Assistant Text Activities

Assistant text has three separate user-visible meanings:

- `assistant.commentary` is assistant-authored progress narration produced
  before or between tool calls. It may be streamed and is safe to show, but it
  is not the final answer.
- `reasoning.summary` is a provider-generated summary of model reasoning. It is
  not hidden chain-of-thought and may be as short as a heading.
- `assistant.stream` is the draft and completion stream for the terminal answer.

Core emits raw text for all three activities. Presentation layers own labels
such as "Working" or "Thinking" and must not relabel final-answer drafts as
reasoning.

## Plan Activity

Agent planning uses the same live activity lane. The agent domain owns the
`update_plan` tool contract and parses successful tool output into active run
state. `src/core/live` owns the user-facing `plan.updated` activity shape that
hosts and control-plane clients can render.

Do not create a second plan subscription, preview endpoint, or UI-only plan
schema. If the plan facts need to change, update the core plan state and the
`ConversationPlanUpdatedActivity` contract here, then let transports carry that
activity unchanged.
