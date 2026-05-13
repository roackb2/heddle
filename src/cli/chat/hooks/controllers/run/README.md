# CLI Chat Run Controller Internals

This folder contains TUI-specific controller internals used by the run-related
controller hooks.

These files are not UI hooks and not shared core behavior. They are host-side
ports, adapters, and helper modules for the CLI run flow.

## Owns

- TUI run lifecycle transitions.
- TUI-specific tool approval port wiring.
- TUI run-loop event adaptation into chat activity/live events.
- Direct-shell execution wiring specific to the TUI host.
- TUI compaction status ports and handlers.

## Does Not Own

- Shared engine semantics.
- Persisted session meaning.
- UI-only draft/picker state.

## Rule

If logic here would need to be copied into another host, it probably belongs in
`src/core` instead.
