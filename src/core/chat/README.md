# Chat

The chat domain is now primarily a boundary folder around the owning
conversation-engine module.

## Owns

- Shared chat/session persisted data contracts in `types.ts`.
- High-level boundary documentation for the conversation engine domain.
- No production behavior should accumulate here when it clearly belongs to the
  engine bounded module.

## Engine Ownership

`src/core/chat/engine/` is the actual owning bounded module for Heddle's
persisted programmatic conversation engine.

That module owns:

- engine config normalization and derived paths
- session persistence, migration, titles, archives, and lease behavior
- persisted turn execution and continuation
- preflight and final compaction lifecycle
- memory maintenance integration for turns
- trace persistence for persisted turns
- engine host normalization and conversation-activity projection

## Does Not Own

- TUI rendering, Ink, React, server transport, or browser hooks
- facade-only wrappers around engine internals

## Notes For Coding Agents

- Put new programmatic conversation-engine behavior under `src/core/chat/engine`.
- Do not reintroduce flat top-level wrappers under `src/core/chat` unless there
  is a concrete, reviewed compatibility reason.
- `types.ts` remains at this level only as a shared persisted contract used by
  engine code plus existing host-facing types. If future cleanup can move it into
  engine without making imports worse, prefer that.
