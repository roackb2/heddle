# Live Events

This document explains how Heddle streams live conversation updates from the
engine to user interfaces. It is a maintenance map, not a transport API spec.

## Goal

Live updates let interfaces show an in-progress run without polling the whole
session after every model delta or tool event.

The shared rule is:

- the conversation engine owns the live event vocabulary;
- server/control-plane code owns transport fanout;
- interfaces own presentation state only.

If the same live behavior is needed by TUI, web-v1, web-v2, or a future
programmatic host, the behavior should move toward the engine event contract
instead of being duplicated per interface.

## Vocabulary

The shared user-facing event contract is `ConversationActivity` in
`src/core/chat/engine/live/types.ts`.

Current activity sources are:

- `agent-loop`: run lifecycle and assistant streaming events such as
  `loop.started`, `assistant.stream`, `loop.finished`, and `run.finished`.
- `trace`: tool and trace-derived events such as `tool.calling`,
  `tool.completed`, `tool.approval_requested`, and related tool outcomes.
- `compaction`: compaction lifecycle events such as `compaction.running`,
  `compaction.finished`, and `compaction.failed`.

Activities should contain enough structured information for each interface to
render an appropriate view. Backend code should not decide display strings for
all clients. Web desktop, mobile, TUI, and programmatic consumers may present
the same activity differently.

## Flow

```mermaid
flowchart TD
  LLM["LLM provider stream"] --> Agent["src/core/agent<br/>model/tool execution"]
  Tools["Tool calls and results"] --> Agent
  Compaction["Compaction service"] --> HostBoundary["conversation engine host boundary<br/>src/core/chat/engine/turns/host"]
  Agent --> Runtime["src/core/runtime/loop<br/>AgentLoopEvent"]
  Runtime --> HostBoundary
  Trace["TraceEvent"] --> HostBoundary
  HostBoundary --> Activity["ConversationActivity<br/>src/core/chat/engine/live/types.ts"]
  Activity --> Publisher["ControlPlaneChatSessionEventsController<br/>publishActivity / publishActivities"]
  Publisher --> Bus["EventEmitter keyed by sessionId"]
  Bus --> Queue["ControlPlaneSessionEventQueue<br/>AsyncIterable adapter"]
  Queue --> TRPC["tRPC subscription<br/>controlPlane.sessionEvents"]
  Bus --> SSE["SSE endpoint<br/>/control-plane/sessions/:id/events"]
  TRPC --> WebV2["web-v2 hook<br/>useControlPlaneSessionEvents"]
  SSE --> WebV1["web-v1 subscription path"]
  Activity --> TUI["TUI host handling"]
  WebV2 --> UIState["Interface-local UI state<br/>streaming message, status line, refresh"]
  WebV1 --> UIState
  TUI --> UIState
```

```text
LLM / tools / compaction
  -> core runtime and trace events
  -> conversation engine host boundary
  -> ConversationActivity
  -> control-plane session publisher
  -> per-session event bus
  -> tRPC subscription or SSE endpoint
  -> interface-local state update
```

The main implementation path is:

- `src/core/agent/model/model-turn-service.ts` receives LLM stream deltas and
  emits `assistant.stream` through runtime callbacks.
- `src/core/runtime/loop/service.ts` exposes runtime loop events.
- `src/core/chat/engine/turns/host/` adapts raw runtime, trace, and compaction
  events into `ConversationActivity`.
- `src/server/features/control-plane/controllers/chat-session-events.ts`
  publishes activity batches for one session.
- `src/server/features/control-plane/controllers/chat-sessions-controller.ts`
  owns in-process fanout, run cancellation state, pending approval state, and
  subscription delivery.
- `src/server/features/control-plane/router.ts` exposes
  `controlPlane.sessionEvents` as a tRPC subscription.
- `src/web-v2/hooks/useControlPlaneSessionEvents.ts` consumes subscription
  events and updates web-v2 UI state.

## Control-Plane Envelopes

The server sends `ControlPlaneSessionEventEnvelope` values to browser clients:

- `session.event`: one or more `ConversationActivity` values for the selected
  session.
- `session.updated`: the persisted session file changed; the UI should refresh
  session detail, usually silently.
- `waiting`: the session file does not exist yet or cannot be watched; the UI
  can show a waiting/reconnecting state.

`session.event` is for live incremental information. `session.updated` is for
durable persisted state. Do not replace streaming with repeated full-session
refreshes; that tends to wipe transient UI state and makes the interface feel
non-streaming.

## Event Examples

These examples show the actual nesting shape so readers do not need to mentally
expand the TypeScript unions before changing a consumer.

Assistant streaming is delivered as a `session.event` envelope containing an
`assistant.stream` activity:

```json
{
  "type": "session.event",
  "sessionId": "session-abc",
  "timestamp": "2026-05-22T01:20:00.000Z",
  "activities": [
    {
      "source": "agent-loop",
      "type": "assistant.stream",
      "event": {
        "type": "assistant.stream",
        "runId": "run-123",
        "step": 1,
        "text": "I am checking the session loader now...",
        "done": false,
        "timestamp": "2026-05-22T01:20:00.000Z"
      },
      "correlation": {
        "runId": "run-123",
        "step": 1,
        "timestamp": "2026-05-22T01:20:00.000Z"
      }
    }
  ]
}
```

A tool status update keeps raw tool details available to each interface:

```json
{
  "type": "session.event",
  "sessionId": "session-abc",
  "timestamp": "2026-05-22T01:20:03.000Z",
  "activities": [
    {
      "source": "trace",
      "type": "tool.calling",
      "event": {
        "type": "tool.calling",
        "tool": "read_file",
        "input": {
          "path": "src/web-v2/hooks/useControlPlaneSessionLoader.ts"
        },
        "timestamp": "2026-05-22T01:20:03.000Z"
      },
      "correlation": {
        "runId": "run-123",
        "step": 1,
        "timestamp": "2026-05-22T01:20:03.000Z"
      },
      "derived": {
        "kind": "tool-summary",
        "summary": "read_file src/web-v2/hooks/useControlPlaneSessionLoader.ts"
      }
    }
  ]
}
```

A persisted session refresh is a separate envelope. It does not carry live
activity; it tells the interface to refetch durable session detail:

```json
{
  "type": "session.updated",
  "sessionId": "session-abc",
  "timestamp": "2026-05-22T01:20:10.000Z"
}
```

A waiting envelope means the subscription is established, but the session file
cannot be watched yet:

```json
{
  "type": "waiting",
  "sessionId": "session-abc",
  "timestamp": "2026-05-22T01:20:00.000Z"
}
```

## Delivery Mechanics

The control-plane controller uses an in-process `EventEmitter` keyed by
`sessionId`. This keeps a live run scoped to the session that produced it.

For tRPC subscriptions, `ControlPlaneSessionEventQueue` adapts EventEmitter
callbacks into an `AsyncIterable`. It is transport infrastructure only:

- buffer events when the browser is not awaiting the next item yet;
- wake pending readers when an event arrives;
- close cleanly when the subscription aborts.

It must not inspect or transform conversation activities. Event vocabulary
belongs to the conversation engine and the session event publisher.

The Express SSE endpoint at
`/control-plane/sessions/:sessionId/events` exists for browser control-plane
delivery as well. New web-v2 code should prefer the tRPC subscription path via
`@trpc/react-query` unless there is a specific transport reason not to.

## Interface Responsibilities

Interfaces may map activities to local UI state:

- append or replace a transient streaming assistant message for
  `assistant.stream`;
- show a one-line status for current tool, compaction, approval, or run state;
- refresh persisted session detail on `session.updated` or final run events;
- clear selected-session-only state when the selected session changes.

Interfaces should not:

- invent new event vocabulary for shared run semantics;
- duplicate backend policy such as run lifecycle or approval ownership;
- map one backend shape into an almost identical interface shape;
- subscribe globally and apply one session's activity to every selected
  session.

If a UI needs richer information to render a good state, add structured fields
to the owning `ConversationActivity` source instead of adding fragile client
guesswork.

## Extending Live Updates

When adding a new live behavior:

1. Decide whether it is shared conversation behavior or interface-only state.
2. If shared, add or extend `ConversationActivity` in
   `src/core/chat/engine/live/types.ts`.
3. Emit the activity at the owning engine or host boundary.
4. Publish through `ControlPlaneChatSessionEventsController` without remapping
   fields unless there is real transport work.
5. Add focused UI handling in the consuming interface.
6. Add a regression test that proves the live event appears before the final
   persisted refresh when streaming behavior matters.

For browser tests, the fake browser-integration agent emits a real
`assistant.stream` preview before the final fake mutation response. That path is
test infrastructure, not production behavior.
