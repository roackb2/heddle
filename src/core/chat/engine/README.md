# Conversation Engine Alpha

This folder owns the alpha programmatic conversation-engine facade for custom
hosts.

## Owns

- Engine-level path derivation from workspace/state roots.
- Session service behavior for persisted chat sessions.
- Turn submit/continue/lease-clear behavior over the persisted conversation-turn
  runner.
- Engine-host normalization from semantic host callbacks into core turn ports.

## Does Not Own

- Low-level conversation-turn internals such as preflight, persistence, memory
  maintenance, or host bridging inside `src/core/chat/conversation-turn.ts`.
- UI rendering, React, Ink, server DTOs, or control-plane transport.
- Storage serialization logic. Use `src/core/chat/storage.ts`.

## Public Entry Points

- `createConversationEngine`
- engine-facing types in `types.ts`

## Common Changes

- Put path defaults in `paths.ts`.
- Put session lifecycle and persistence-facing CRUD in `session-service.ts`.
- Put host normalization and activity projection in `host.ts`.
- Put submit/continue option merging and lease helpers in `turn-service.ts`.

## Notes For Coding Agents

- The engine must own real invariants and option normalization. Do not reduce it
  to a thin wrapper around `submitChatSessionPrompt` or `runConversationTurn`.
- Preserve storage compatibility and host-agnostic behavior.
- If package-root exports point here, keep docs marked alpha.
