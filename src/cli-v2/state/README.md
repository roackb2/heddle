# cli-v2 Session State

This folder owns the terminal app model for one control-plane session view.
It is intentionally a TUI orchestration layer: core services and the
control-plane API own domain policy, while Ink components render a single
snapshot and call user-intent methods.

## Ownership

- `control-plane-session-store.ts` is the public facade consumed by Ink. Keep it
  small: construct workflow owners, expose `getSnapshot`/`subscribe`, and route
  user intents.
- `control-plane-session-state.ts` owns the canonical mutable render snapshot
  and subscription mechanics. Renderable TUI facts belong in this one snapshot,
  not in scattered workflow-local state.
- `control-plane-session-loader.ts` owns workspace/session loading, selection,
  runtime-context refresh, pending-approval refresh trigger, and event-stream
  attachment ordering.
- `control-plane-prompt-controller.ts` owns prompt intent routing and normal
  prompt submission state transitions. Prompt parsing rules stay in
  `client-shared`.
- `control-plane-slash-command-controller.ts` owns slash command API
  orchestration after execution. Slash command definitions, parsing, aliases,
  and semantics stay in core/control-plane.
- `control-plane-direct-shell-controller.ts` owns TUI direct-shell confirmation
  state and direct-shell run submission. Shell policy and command execution stay
  in core/control-plane.
- `control-plane-approval-controller.ts` owns pending-approval mirroring and
  resolution state. Approval policy remains server/core-owned.
- `control-plane-run-controller.ts` owns the accepted run mirror, terminal
  state, exact-run cancellation, and run-state polling fallback. The shared
  replayable run stream remains the source of truth.
- `control-plane-live-event-reducer.ts` owns reduction of control-plane live
  events into the TUI snapshot. Shared activity semantics stay in
  `client-shared`.

## Invariants

- The TUI has one render-state source of truth: `ControlPlaneSessionState`.
- Workflow controllers may keep private lifecycle mechanics only when those
  facts are not render state, such as timers or stream buffers.
- Do not import core, server, or old CLI modules from cli-v2. Consume
  control-plane APIs and `client-shared` types/services.
- Attach detailed activity through `sessionRunEvents`; keep `sessionEvents`
  limited to lifecycle discovery, approval, queue, and persisted-state signals.
- Reuse `ClientSharedConversationRunStreamService` for sequence cursors,
  duplicate suppression, gap detection, and reconnect policy.
- Do not add a controller that only forwards calls. A controller must own real
  workflow behavior: ordering, state transitions, lifecycle reset, event
  reduction, or terminal UX coordination.
- Do not duplicate domain policy in this folder. If a rule belongs to slash
  commands, shell policy, model capabilities, approvals, or activity semantics,
  move it to the owning core/control-plane/client-shared module instead.
