# TUI Chat Host

This folder is the terminal chat host for Heddle.

Its job is to present chat state, wire user interaction to host actions, and
adapt engine/runtime behavior into the TUI. It must not become a second owner
for chat policy or persisted semantics.

## Layering Direction

Treat this area as Heddle's host-side application plus presentation layer.
Treat any drift toward domain-policy ownership here as architectural debt to
remove.

Use this mental model:

- **View**: Ink components and `App.tsx` render state and forward user intent.
- **Hooks**: `hooks/` are the CLI host integration layer. They include both
  controller hooks like `use...Controller` and UI-local state hooks. Obvious
  flow owners may live under `hooks/controllers/`.
- **Domain/engine**: `src/core/chat/engine/` and adjacent core domains own
  persisted conversation semantics, session policy, compaction behavior,
  approval truth, and runtime defaults.

Even though the TUI is local, it should behave like a client of core services:
the host calls core services, and those services call storage/repositories.
The host should not reach through to file-backed session storage directly as a
stable architecture pattern.

The TUI must become thinner over time. `App.tsx` should converge toward a
presentation composition root, not a policy switchboard.

## Owns

- Ink rendering, layout, and TUI-specific interaction flow.
- Host-side orchestration for keyboard input, picker state, panel visibility,
  and user-triggered actions.
- Translation between TUI events and chat/runtime application actions.
- View-model shaping that exists only to support presentation.

## Does Not Own

- Persisted session semantics.
- Model or reasoning inheritance/default policy.
- Compaction policy or memory-maintenance rules.
- Approval policy, trace policy, or runtime bootstrap policy.
- Re-resolving defaults/fallbacks already decided by an owning domain.
- Long-lived non-UI state whose meaning must stay consistent across hosts.

## Refactor Rule

When a TUI feature exposes scattered policy, do not patch the view with another
local fallback chain. Move the ownership out.

Prefer this sequence:

1. identify the real owner;
2. move the policy into that owner;
3. have the TUI consume a concrete result;
4. delete the redundant host-side interpretation;
5. keep `App.tsx` focused on rendering and event wiring.

Bad signs in this folder:

- `x ?? y ?? z` repeated across hooks and components;
- session/runtime policy inferred from local React state;
- the same fallback/default logic repeated in App, hooks, and engine callers;
- broad option bags passed downward and reinterpreted again.

Good signs:

- one owner decides;
- hosts pass clear intent upward;
- views receive resolved values and render them;
- orchestration code is short enough to review without reconstructing policy.

## Controller Hooks vs UI Hooks

Keep the difference strict:

- `use...Controller`: interface-specific flow ownership
- other hooks: React-local state/adaptation only

Do not create a second folder full of hook files just to simulate architecture.
The question is ownership, not syntax.

If a module coordinates session switching, prompt submission, compaction
triggering, or other multi-step CLI flow, it should live in `hooks/` but be
named as a controller hook.

See [docs/strategy/chat-layering.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/strategy/chat-layering.md)
for the target folder structure and layering rules.
