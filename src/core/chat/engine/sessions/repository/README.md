# File Session Repository

This folder owns file-backed chat session persistence.

## Owns

- session catalog file layout
- per-session file layout
- migration from legacy `chat-sessions.json`
- serialization, deserialization, and orphan cleanup

## Does Not Own

- session behavior or policy
- host/UI flow
- default/fallback resolution beyond what is required to deserialize old data

## Boundary

- session services call this repository
- hosts should not call it directly when a core session service can own the flow
- do not add wrapper-only repository files; this folder earns its place by
  owning real file persistence mechanics
