# Observability

The observability domain is the home for trace/event conventions, trace
summaries, and debugging evidence contracts.

## Owns

- Stable trace/event naming conventions.
- Durable trace summary policy.
- Compact tool call/result summaries used by activity and trace summaries.
- Correlation-field conventions such as run id, session id, turn id, and step.

## Does Not Own

- Low-level event emission inside the agent loop.
- UI rendering of activity.
- User-facing live conversation activity contracts. Those belong to
  `src/core/live/` because TUI, web, and programmatic chat hosts all consume
  them.
- Storage of chat sessions.
- Logger configuration unrelated to trace/event contracts.

## Current Source Locations

Observability behavior currently exists in these places:

- `src/core/types.ts` for `TraceEvent`.
- `src/core/runtime/loop/types.ts` for `AgentLoopEvent`.
- `src/core/trace/` for low-level event recording and console formatting.
- `src/core/chat/engine/turns/trace/` for persisted chat trace files.
- `src/core/observability/summaries/` for turn summary evidence.
- `src/core/observability/semantics/` for shared trace names.
- `src/core/live/` for shared host activity projection, typed
  activity handlers, and tool call/result activity summaries.
- `src/cli/chat/hooks/controllers/run/tui-run-loop-events.ts` for TUI activity rendering.
- `src/web/features/control-plane/hooks/sessions-screen/useSessionDetailSubscription.ts` for web activity rendering.
- `src/server/controllers/trpc/control-plane/chat-session-events.ts`.

## Public Entry Points

These APIs are exported from the package root for host authors. Treat the event
names and core fields as stable, but treat new optional metadata fields as
additive: consumers should ignore fields they do not use.

- `TraceSummaryService`: durable trace event summaries. These summaries feed
  turn/session evidence such as `TurnSummary.events`; they are not the live
  TUI/web status layer.
- `ToolActivitySummarizer`: compact tool call/result labels. Reuse this instead
  of reimplementing path/command/query summaries in host adapters.
- `TRACE_EVENT_TYPES`, `TRACE_EVENT_DOMAINS`, and `TRACE_CORRELATION_FIELDS`:
  event naming and correlation conventions.

## Extension Points

- Add trace summaries by constructing `new TraceSummaryService(...)` with a
  domain-specific summarizer map.
- Add new trace event families with compatibility tests and documented
  attributes.

## Common Changes

- To add a trace event, update the type, recorder/emitter, summarizer, formatter
  if needed, and host projection tests.
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
- Use handler maps and registries for trace summaries; avoid central
  switchboards growing without structure.
