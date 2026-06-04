# CLI V2 Boundary

`src/cli-v2` is the terminal UI implementation.

## Import Rule

- `cli-v2` may import shared API-consumer code from `src/client-shared`.
- `cli-v2` must not import from retired legacy TUI code.
- `cli-v2` TUI/client code must not import core services, server controllers,
  or backend DTOs directly. It consumes tRPC-derived types and the shared proxy
  client.
- `cli-v2/commands` owns terminal command bootstrap. It may discover or start a
  local control-plane server when needed, then command behavior should continue
  through the shared control-plane API instead of calling core services
  directly.
- If terminal rendering code is worth preserving, it must live here and consume
  `cli-v2` view/state types directly.

## Shape

- `commands/`: terminal command bootstrap and process lifecycle around the
  API-backed v2 clients. See [`commands/README.md`](./commands/README.md) for
  the migration classification of remaining terminal commands.
- `state/`: class-based API-consumer state and live subscription ownership.
- `hooks/`: React/Ink hooks only. Hook files keep `useXxx` naming and return
  hook-shaped values.
- `services/`: TUI-specific domain services used by hooks and components.
  Services are not hooks; they centralize terminal-only logic behind clear
  class boundaries.
- `components/`: terminal rendering components.
- `index.tsx`: launch entrypoint that receives a tRPC URL from the outer CLI.
