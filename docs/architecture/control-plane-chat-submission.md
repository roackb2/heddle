# Control-Plane Chat Submission

This document explains how browser and terminal control-plane clients submit a
chat prompt, how the accepted user message becomes durable session state, and
how live streaming and final synchronization work.

It complements:

- `docs/architecture/chat-layering.md`, which defines ownership boundaries.
- `docs/architecture/live-events.md`, which defines live activity delivery.

## Goal

Interactive clients should not wait on a long-running prompt mutation before
they can return control to the user. A prompt submission has two separate
moments:

1. The server accepts the user prompt and records it on the session.
2. The agent run streams activity and eventually persists the completed turn.

Web-v2, cli-v2, and future mobile clients should all consume the same
control-plane API. No API or controller should be named for a specific client.

## API Options

The control-plane router exposes two prompt submission shapes.

### `controlPlane.sessionSendPromptAsync`

Use this for interactive clients such as web-v2, cli-v2, and future mobile
surfaces.

The endpoint returns after the server accepts the prompt:

```ts
type ControlPlaneAcceptedSessionRun = {
  accepted: true;
  workspaceId: string;
  sessionId: string;
  runId: string;
  acceptedAt: string;
};
```

After the accepted response, clients render the run from:

- persisted session state from `controlPlane.session`;
- ordered activity and terminal state from `controlPlane.sessionRunEvents`,
  addressed by the returned `runId`;
- lifecycle discovery from `controlPlane.sessionEvents`;
- fallback run state from `controlPlane.sessionRunState`.

If another run already owns the session, a normal prompt can instead return a
`queued: true` result. The queued prompt receives its own run identity through
`session.run.updated` when it is admitted later; clients do not invent an ID or
reuse the preceding run's stream.

### `controlPlane.sessionSendPrompt`

Use this for completion-oriented callers that intentionally want to wait for the
final result.

The endpoint starts the same run path, but waits until the engine turn resolves
and returns the final result:

```ts
type ControlPlaneSessionSendPromptResult = {
  outcome: string;
  summary: string;
  session: ControlPlaneSessionDetail | null;
};
```

Do not use this from interactive browser or terminal UI code. It makes one
mutation represent both "request accepted" and "agent finished", which causes
stale loading states and blocks normal run synchronization.

## Accepted User Message

When `sessionSendPromptAsync` accepts a prompt, the server immediately persists
the user message through the core conversation session service.

The accepted line is a normal visible session message:

```ts
type ConversationLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isPending?: boolean;
};
```

For an active accepted run, the user line uses `isPending: true`. It is durable
host-facing state, not a local optimistic UI message.

This is important for cross-device continuity:

- if a prompt is submitted from cli-v2, web-v2 should show it;
- if a prompt is submitted from web-v2, cli-v2 should show it;
- if the daemon restarts after accepting the prompt, the session should still
  show what the user sent;
- agent thinking, tool activity, and assistant streaming should not appear above
  or without the user prompt that caused them.

The accepted prompt is not pre-appended to model-facing `session.history`.
During the turn, the chat engine receives the prompt as the current turn input.
Final turn persistence rebuilds `session.history` and visible messages from the
completed transcript.

## Server Flow

The main flow is:

```text
client
  -> controlPlane.sessionSendPromptAsync
  -> ControlPlaneChatSessionsController.submitPromptAsync
  -> ConversationRunService.start
  -> ConversationSessionService.acceptUserMessage
  -> background ConversationEngine.turns.submit
  -> ConversationRunService ordered activity + terminal
  -> controlPlane.sessionRunEvents replayable delivery
  -> final ConversationEngine persistence
  -> session.run.updated settled / sessionRunState false / refreshed detail
```

`ConversationRunService` owns reusable run coordination for both SDK hosts and
Heddle's control-plane clients:

- in-flight run registry;
- accepted run id generation;
- abort controller lifecycle;
- pending approval resolver cleanup;
- async start vs wait-for-result behavior;
- ordered replay buffers and one terminal item;
- active-run discovery and exact-run cancellation.

`chat-session-run-stream.ts` is the transport adapter. It projects the generic
run result into the stable control-plane result shape and fans out run
started/settled discovery signals. It does not implement another run registry.

It does not own persisted chat meaning. Core chat/session services own:

- accepted user-message semantics;
- lease admission before acceptance;
- preserving accepted messages through preflight persistence;
- clearing accepted pending state on final success or failure;
- rebuilding final transcript state.

## Admission and Failure

Async acceptance is an admission boundary, not just a background promise start.
The server must reject before returning `accepted` when a session cannot accept
a run, including active-run and lease conflicts.

If execution fails after acceptance, the accepted user message remains durable,
but the pending marker is cleared and an assistant failure message is appended.
The user should see that their message was accepted and that the run failed,
rather than seeing a disappearing prompt or a permanently pending user line.

## Streaming and Synchronization

Live streaming is primary:

- `controlPlane.sessionRunEvents` carries ordered activity plus the result,
  cancellation, or error terminal for one `runId`;
- clients reconnect with `afterSequence` and replay from their last accepted
  item;
- `controlPlane.sessionEvents` carries run identity, queue, approval, and
  persisted-session lifecycle signals;
- `session.updated` tells clients to refetch persisted session detail.

Polling is a fallback:

- clients query `controlPlane.sessionRunState` while a run is believed active;
- when polling observes `running: false`, clients refetch session detail,
  session list, and pending approval state;
- polling lets a refreshed client recover `activeRun` if it missed the
  lifecycle start signal and confirms final state when transport recovery is
  exhausted.

Do not poll the whole session for every stream delta. Streaming activities
should update interface-local transient state, while durable session refreshes
should happen at session update and finalization boundaries.

## Client Responsibilities

Interactive clients should:

- call `sessionSendPromptAsync`;
- treat `submitting` as "waiting for accepted response";
- treat `running` as "server run active or believed active";
- keep draft typing available while a run is active;
- allow normal prompts to enter the server-owned queue while a run is active;
- render the accepted user prompt from server session state;
- attach `sessionRunEvents` using the accepted, discovered, or recovered run ID;
- render assistant stream and tool status from ordered run activities;
- treat the run terminal—not `loop.finished` presentation activity—as the
  authoritative completion boundary;
- target cancellation with the observed run ID;
- refresh session detail when receiving `session.updated` or when
  `sessionRunState` changes from active to inactive.

Interactive clients should not:

- add client-only optimistic user messages for accepted prompts;
- call core chat services directly;
- use `sessionSendPrompt` for normal interactive chat;
- infer run completion only from a mutation finishing;
- duplicate run cursor, gap, or reconnect policy per interface;
- let cached `sessionRunState.running === false` cancel a freshly submitted run
  before a post-submit run-state refetch returns.

## Current Consumers

Current intended usage:

- `src/web-v2/hooks/sessions/useControlPlaneSessionPromptSubmit.ts` uses
  `sessionSendPromptAsync`.
- `src/web-v2/hooks/sessions/useControlPlaneSessionEvents.ts` consumes
  lifecycle and replayable run subscriptions.
- `src/web-v2/hooks/sessions/useControlPlaneSessionRunControl.ts` handles
  accepted run identity, exact cancellation, terminal state, and polling
  fallback.
- `src/cli-v2/services/sessions/control-plane-session-api-service.ts` exposes
  `sendPromptAsync`.
- `src/cli-v2/services/sessions/control-plane-session-subscription-service.ts`
  binds the shared run cursor service to the Node tRPC transport.
- `src/cli-v2/state/control-plane-run-controller.ts` mirrors accepted run
  identity, terminal state, exact cancellation, and polling fallback.

Completion-oriented or compatibility callers may still use
`sessionSendPrompt`, but new interactive clients should not.

## Extending This Flow

When adding new chat submission behavior:

1. Decide whether it belongs to prompt acceptance, live run activity, or final
   transcript persistence.
2. Put persisted meaning in `src/core/chat/engine`.
3. Put run transport projection in `chat-session-run-stream.ts` and keep
   conversation application orchestration in `chat-sessions-controller.ts`.
4. Put transport exposure in `src/server/routes/trpc/control-plane.ts`.
5. Put shared API-consumer types in `src/client-shared`.
6. Keep web-v2 and cli-v2 consumers aligned unless the difference is purely
   rendering or input ergonomics.
