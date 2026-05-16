# Chat

This folder is the shared chat boundary above the owning conversation-engine
domain.

It should describe the layering and shared contracts for Heddle chat, while
keeping real persisted-session and turn policy inside the engine. New behavior
must not accumulate here unless it is genuinely boundary-level.

## Owns

- Shared chat/session persisted data contracts in `types.ts`.
- High-level boundary documentation for chat layering.
- Application-level guidance for where host concerns should stop and engine
  concerns should begin.

## Layering Model

Use a simple MVC-like split:

- **View**: TUI/web presentation surfaces under `src/cli/` and `src/web/`.
- **Application/controller**: host-specific orchestration that adapts user
  actions into engine/runtime calls.
- **Domain/engine**: `src/core/chat/engine/` owns persisted chat semantics and
  policy.

Heddle is not strict classical MVC, but the responsibility split must feel this
simple in practice: views render, controllers orchestrate, and the engine owns
meaning.

## Engine Ownership

`src/core/chat/engine/` is the actual owning bounded module for Heddle's
persisted programmatic conversation engine.

That module owns:

- engine config normalization and derived paths
- session persistence, migration, titles, archives, lease behavior, and session
  execution preferences
- persisted turn execution and continuation
- preflight and final compaction lifecycle
- memory maintenance integration for turns
- trace persistence for persisted turns
- engine host normalization and conversation-activity projection

## Does Not Own

- TUI rendering, Ink, React, server transport, or browser hooks.
- Host-local fallback/default logic that should be resolved once by the owning
  engine or adjacent core domain.
- facade-only wrappers around engine internals.
- policy modules that really belong inside the engine or another explicit core
  domain.

## Notes For Coding Agents

- Put new programmatic conversation-engine behavior under `src/core/chat/engine`.
- Treat the current engine services as the reference implementation pattern:
  class-based services, explicit `types.ts` contracts, class-based
  repositories, schema/codec-owned persistence validation, and no loose one-off
  exported domain functions. Meaningful classes should also include a brief
  responsibility comment so future agents know what belongs there.
- Keep `src/core/chat/` itself small. If a new module here is not defining a
  shared contract or a real boundary, it probably belongs somewhere else.
- If a value's meaning must stay consistent across hosts, the owning logic
  should not live here as host glue or documentation-only convention. Put it in
  the engine or another explicit domain owner.
- Do not reintroduce flat top-level wrappers under `src/core/chat` unless there
  is a concrete, reviewed compatibility reason.
- `types.ts` remains at this level only as a shared persisted contract used by
  engine code plus existing host-facing types. If future cleanup can move it into
  engine without making imports worse, prefer that.

See [docs/architecture/chat-layering.md](../../../docs/architecture/chat-layering.md)
for the target folder structure and layering rules.
