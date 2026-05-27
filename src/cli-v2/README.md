# CLI V2 Boundary

`src/cli-v2` is the clean terminal UI rewrite. It is intentionally
self-contained while it is being built next to the existing TUI.

## Import Rule

- `cli-v2` may import shared API-consumer code from `src/client-shared`.
- `cli-v2` must not import from `src/cli/chat`.
- `cli-v2` must not import core services, server controllers, or backend DTOs
  directly. It consumes tRPC-derived types and the shared proxy client.
- If terminal rendering code is worth preserving from the old TUI, copy it into
  this folder and make it consume `cli-v2` view/state types.

The old `src/cli/chat` tree remains available only as the current production
fallback until `cli-v2` reaches parity. It is not a dependency boundary for this
rewrite.

## Shape

- `state/`: class-based API-consumer state and live subscription ownership.
- `hooks/`: React/Ink hooks only. Hook files keep `useXxx` naming and return
  hook-shaped values.
- `helpers/`: TUI-specific pure projections and formatting helpers. Keep these
  under a domain folder such as `activities/` or `approvals/`.
- `components/`: terminal rendering components.
- `index.tsx`: launch entrypoint that receives a tRPC URL from the outer CLI.
