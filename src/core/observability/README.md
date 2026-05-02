# Observability

The observability domain is the planned home for trace/event conventions,
summarizers, activity projections, and debugging evidence contracts.

## Owns

- Stable trace/event naming conventions.
- Trace summarizer registration.
- Conversation activity projection from runtime/trace events.
- Correlation-field conventions such as run id, session id, turn id, and step.
- Compatibility guidance for trace files and host projections.

## Does Not Own

- Low-level event emission inside the agent loop.
- UI rendering of activity.
- Storage of chat sessions.
- Logger configuration unrelated to trace/event contracts.

## Current Source Locations

Observability behavior currently exists in several places:

- `src/core/types.ts` for `TraceEvent`.
- `src/core/runtime/events.ts` for `AgentLoopEvent`.
- `src/core/trace/recorder.ts` and `src/core/trace/format.ts`.
- `src/core/chat/trace.ts` and `src/core/chat/trace-summary.ts`.
- `src/cli/chat/hooks/tui-run-loop-events.ts`.
- `src/web/features/control-plane/hooks/sessions-screen/useSessionDetailSubscription.ts`.
- `src/server/features/control-plane/services/chat-session-events.ts`.

Future milestones should centralize shared summarization and projection here
while preserving compatibility wrappers for existing imports.

## Planned Public Entry Points

- `semantic-conventions.ts`: event naming and correlation conventions.
- `trace-summarizers.ts`: registry for trace event summaries.
- `conversation-activity.ts`: shared host-agnostic activity projection.

## Extension Points

- Add trace summaries by registering a summarizer for an event type.
- Add UI activity by projecting raw runtime/trace events into host-agnostic
  activity events, then render those in TUI or web adapters.
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

