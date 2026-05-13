# CLI Chat Hooks

This folder is the React integration layer for the CLI chat host.

A hook is a delivery form. In this host, both controller hooks and UI-local
hooks live here.

## Rule

- If a module owns interface-specific orchestration and is implemented with
  React hooks, it still belongs here. Name it `use...Controller` so the role is
  explicit.
- If a module is a reusable React state/helper primitive for the CLI view, it
  belongs in `hooks/`.
- If the logic should be shared across hosts, it does not belong here. Move it
  to `src/core`.

## Hooks Own

- Controller hooks for CLI-specific orchestration.
- UI-only ephemeral state.
- Input helpers for the TUI.
- View-facing derived state that exists only for rendering or local interaction.
- Thin adapters that expose core results in a React-friendly form.

## Hooks Do Not Own

- Persisted semantics.
- Defaults, inheritance, or fallback policy.
- Storage mechanics.
- Cross-host behavior.
- Shared cross-host orchestration or shared policy.

## Simple Test

Ask two questions:

1. Is this logic specific to the CLI interface?
2. Is it implemented as React state/effects/adaptation for the CLI host?

If the answer is "yes" to both, `hooks/` is probably right.

Then make the role explicit:

- `use...Controller` for interface-specific orchestration
- `use...State` / `use...Picker` / `use...Draft` for UI-local state
- plain `use...` for small host adapters when a more specific name is not worth it

Do not create a second folder full of hook files just to simulate architecture.

## Cheap Organization

Use lightweight subfolders when it helps readability:

- `hooks/controllers/` for obvious flow owners
- `hooks/controllers/run/` for non-hook TUI run/controller internals
- top-level `hooks/` for UI-local hooks and small adapters

Only create more structure when it removes confusion. Do not create nested
folders that contain wrappers with no real job.
