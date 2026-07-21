# Session Activity Client Effects

This service owns frontend-neutral effects derived from control-plane session
activities. It is the shared interpretation layer used by web-v2 and cli-v2
after they receive API-provided live events.

## Owns

- Mapping each API activity type to shared client effects.
- Shared live status copy for activity progress.
- Shared derived labels for tool-related activities.
- Shared effects for final-answer, commentary, and reasoning-summary streams;
  each remains a distinct activity so clients can present them independently.
- Active plan lifetime at the client edge: `plan.updated` sets the visible plan,
  `loop.started` and `loop.finished` clear it.

## Does Not Own

- Activity facts or schemas. Those belong to `src/core/live` and flow through
  tRPC-derived client types.
- Plan parsing or validation. That belongs to the core agent planning/tool
  modules.
- React state, Ink state, layout, or rendering.
- Control-plane transport or subscription setup.

## Boundary

Do not add duplicated activity switchboards in web-v2 or cli-v2. Add a shared
effect here when both clients need to react to the same control-plane activity.
Client code should provide state setters and render the resulting state in its
own UI language.
