# File Session Repository

This folder owns file-backed chat session persistence.

## Owns

- session catalog file layout
- per-session file layout
- persisted JSON contract in `chat-session-schemas.ts`
- serialization/deserialization behavior through `ChatSessionCodec`
- orphan cleanup

## Does Not Own

- session behavior or policy
- host/UI flow
- default/fallback resolution beyond what is required to deserialize old data

## Boundary

- session services instantiate `FileChatSessionRepository`
- older host and test paths may call class methods directly while they are being
  moved behind services
- hosts should not call it directly when a core session service can own the flow
- disk-shape validation belongs in `chat-session-schemas.ts`, not in ad hoc
  repository type guards
- do not add wrapper-only repository files; this folder earns its place by
  owning real file persistence mechanics
