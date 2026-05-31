# Agent Planning

This module owns the agent loop's interpretation of successful `update_plan`
tool output.

## Owns

- Parsing `update_plan` tool output into `AgentPlanState`.
- Preserving the canonical plan item shape from the tool contract: `step` plus
  `pending`, `in_progress`, or `completed` status.
- Rejecting malformed plan output by returning no active plan instead of
  inventing fallback plan data.

## Does Not Own

- The `update_plan` tool input schema or validation. That belongs to
  `src/core/tools/toolkits/internal/update-plan.ts`.
- Live event transport. That belongs to `src/core/live` and the runtime host
  callback path.
- Web, TUI, or CLI rendering.
- Client-side visibility lifetime after events are received.

## Boundary

Other modules should not reparse `update_plan` payloads. The agent tool turn
updates `context.state.activePlan` from this parser, then emits the live
`plan.updated` activity from that parsed state.
