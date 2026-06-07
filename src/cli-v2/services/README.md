# CLI V2 Services

`src/cli-v2/services` owns terminal-UI-specific domain logic that is shared
inside `cli-v2` by hooks and components.

## Boundary

- Only TUI-specific logic belongs here.
- Services may consume `src/client-shared` API-consumer types and `cli-v2`
  state/view types. Shared browser/TUI API-result projections should live in
  `src/client-shared`, with cli-v2 services adding only terminal behavior on
  top.
- Services must not import retired legacy TUI code, core services, server
  controllers, or backend DTO modules.
- Services are not React or Ink hooks. Do not use `useXxx` naming here.
- Hooks and components may call public service methods, including static
  methods, when the service owns meaningful terminal behavior.

## Shape

Use class-based services when a domain has named behavior to extend, test, or
share. Keep methods grouped by domain instead of adding free-floating helpers.

Current domains:

- `activities/`: prompt activity and terminal latest-update projections for
  rendering.
- `approvals/`: terminal approval choices, decisions, and keyboard-specific
  behavior.
- `pickers/`: terminal picker filtering and keyboard index mechanics over
  control-plane-provided model/session data.
- `sessions/`: terminal session lifecycle mechanics such as stream buffering
  API runtime defaults, subscriptions, and run-state polling that are specific
  to Ink rendering and cli-v2 store coordination.
- `slash-commands/`: local hint filtering and tab completion over
  control-plane-provided slash command metadata, plus TUI-local slash-style
  commands whose entire effect is terminal presentation state. Keep commands
  here only when they operate on Ink-local UI state such as disclosure expansion,
  focused terminal review mode, or terminal-only result visibility. Put commands
  in core/control-plane slash modules when they affect shared session, runtime,
  model, auth, heartbeat, compaction, or workspace behavior, or when another
  host should observe the same command semantics.
- `status/`: terminal status-bar formatting over control-plane runtime context.
