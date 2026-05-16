# Conversation Turns

This folder owns persisted conversation-turn execution for the conversation
engine.

Hosts should enter through `EngineConversationTurnService`, normally via
`createConversationEngine(...).turns`. Do not add standalone runner functions
or compatibility wrappers here. If behavior belongs to a turn phase, put it on
the class that owns that phase.

## Folder Roles

- `service.ts`: main submit, continue, and lease cleanup service.
- `runtime/`: resolves model, provider, credentials, memory path, system
  context, and LLM adapter.
- `context/`: loads the session and builds the concrete turn context.
- `preflight/`: owns lease acquisition and pre-run compaction persistence.
- `persistence/`: builds turn artifacts and writes completed turns back to
  session storage.
- `memory/`: runs inline/background memory maintenance and records its trace
  evidence.
- `host/`: normalizes host callbacks and bridges them into agent-loop ports.
- `trace/`: writes persisted trace files.

## Boundary Rules

- `types.ts` files are the read-first contracts for each subdomain.
- Use classes for grouped domain behavior. Use static methods when no instance
  state is needed.
- Keep pure, domain-owned behavior on the owning class instead of exporting
  loose functions.
- Use `@/...` imports for cross-domain references; reserve relative imports for
  same-folder files and local subdomain indexes.
