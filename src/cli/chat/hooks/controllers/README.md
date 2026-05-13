# CLI Chat Controller Hooks

This subfolder holds React hooks that own CLI-specific orchestration.

These files still live under `hooks/` because they are React host integration
modules, but their role is different from UI-local hooks.

## Owns

- Session-switch flow for the CLI host.
- Prompt submission flow for the CLI host.
- Run/compaction sequencing for the CLI host.
- Other multi-step TUI flows that compose core/domain operations.

## Does Not Own

- Shared cross-host semantics.
- Storage mechanics.
- Defaults/fallbacks that should be resolved once in `src/core`.

## Naming Rule

Controller hooks must be explicit:

- `useChatAppController`
- `usePromptSubmissionController`
- `useAgentRunController`

If a hook owns flow orchestration and is not named as a controller, the
boundary is getting muddy again.
