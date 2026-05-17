# Observability

The observability domain is the home for trace/event conventions,
source-event-backed activity projection, trace summaries, and debugging
evidence contracts.

## Owns

- Stable trace/event naming conventions.
- Durable trace summary policy.
- Conversation activity projection from runtime/trace events.
- Compact tool call/result summaries used by activity and trace summaries.
- Correlation-field conventions such as run id, session id, turn id, and step.

## Does Not Own

- Low-level event emission inside the agent loop.
- UI rendering of activity.
- Storage of chat sessions.
- Logger configuration unrelated to trace/event contracts.

## Current Source Locations

Observability behavior currently exists in these places:

- `src/core/types.ts` for `TraceEvent`.
- `src/core/runtime/loop/types.ts` for `AgentLoopEvent`.
- `src/core/trace/recorder.ts` and `src/core/trace/format.ts`.
- `src/core/chat/engine/turns/trace/` for persisted chat trace files.
- `src/core/observability/summaries/` for turn summary evidence.
- `src/core/observability/semantics/` for shared trace names.
- `src/core/observability/activity/` for shared host activity projection,
  typed activity handlers, and tool call/result activity summaries.
- `src/cli/chat/hooks/controllers/run/tui-run-loop-events.ts` for TUI activity rendering.
- `src/web/features/control-plane/hooks/sessions-screen/useSessionDetailSubscription.ts` for web activity rendering.
- `src/server/features/control-plane/controllers/chat-session-events.ts`.

## Public Entry Points

These APIs are exported from the package root for host authors. Treat the event
names and core fields as stable, but treat new optional metadata fields as
additive: consumers should ignore fields they do not use.

- `TraceSummaryService`: durable trace event summaries. These summaries feed
  turn/session evidence such as `TurnSummary.events`; they are not the live
  TUI/web status layer.
- `ConversationActivityProjector`: shared host-agnostic activity projection and
  typed handler-map dispatch for frontend adapters.
- `ToolActivitySummarizer`: compact tool call/result labels. Reuse this instead
  of reimplementing path/command/query summaries in host adapters.
- `TRACE_EVENT_TYPES`, `TRACE_EVENT_DOMAINS`, and `TRACE_CORRELATION_FIELDS`:
  event naming and correlation conventions.

Projected activities retain the original source event under `activity.event`.
Do not copy fields such as `tool`, `step`, `timestamp`, `ok`, or `summary` into
another parallel activity shape. Add `activity.derived` only when this boundary
does real work, such as tool summary generation or CyberLoop metric formatting.

## Extension Points

- Add trace summaries by constructing `new TraceSummaryService(...)` with a
  domain-specific summarizer map.
- Add UI activity by projecting raw runtime/trace events into host-agnostic
  activity events, then render those in TUI or web adapters.
- Add host activity handlers with `satisfies ConversationActivityHandlerMap` so
  each handler receives the narrowed activity type for its key. Use
  `ConversationActivityProjector.applyHandler(...)` for dispatch.
- Add new trace event families with compatibility tests and documented
  attributes.

## Common Changes

- To add a trace event, update the type, recorder/emitter, summarizer, formatter
  if needed, and host projection tests.
- To change web/TUI live status behavior, first check whether the semantic
  projection belongs here and the wording belongs in the host adapter.
- To add debugging evidence, prefer structured fields over plain text.

## Tests

- `src/__tests__/unit/core/trace-format.test.ts`
- `src/__tests__/unit/tui/chat-activity-format.test.ts`
- `src/__tests__/integration/web/control-plane-sessions-state.test.tsx`
- `src/__tests__/integration/chat/chat-runtime.test.ts`

## Notes For Coding Agents

- Traces are product evidence, not incidental logs.
- Preserve existing event names and summaries unless a milestone explicitly
  changes them.
- Use handler maps and registries for projections/summaries; avoid central
  switchboards growing without structure.
- Keep activity vocabulary aligned with upstream event vocabulary. If a layer is
  only passing fields through, pass the source event instead of reassigning each
  field.
