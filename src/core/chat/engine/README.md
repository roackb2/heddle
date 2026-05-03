# Conversation Engine Alpha

This folder is the owning bounded module for Heddle's persisted programmatic
conversation engine.

## Owns

- Normalized engine config and derived paths in `config.ts`.
- File-backed session persistence, migration, lease rules, titles, archives, and
  conversation-line projection under `sessions/`.
- Persisted turn execution, runtime resolution, preflight compaction, memory
  maintenance, trace persistence, final durable persistence, and host adaptation
  under `turns/`.
- The alpha programmatic API through `conversation-engine.ts` and `index.ts`.

## Does Not Own

- TUI rendering, React, Ink, server DTOs, or control-plane transport.
- Low-level model/tool step execution internals outside the runtime/agent
  domains.

## Public Entry Points

- `createConversationEngine`
- `runConversationTurn`
- `clearConversationTurnLease`
- engine-facing types in `types.ts`

## Common Changes

- Put normalized config, path defaults, and engine-wide defaults in `config.ts`.
- Put persisted session lifecycle behavior in `sessions/service.ts` and related
  `sessions/*` modules.
- Put lower-level turn-host bridge fanout in `turns/host-bridge.ts`.
- Put engine host normalization and `ConversationActivity` projection in
  `turns/host.ts`.
- Put submit/continue behavior in `turns/service.ts`.
- Put persisted turn phases in `turns/*`.
- Put shared compaction/history behavior in `history/compaction.ts`.

## Notes For Coding Agents

- Do not rebuild flat `src/core/chat/*` wrappers around engine internals.
- The engine must own real behavior, not facade-only forwarding.
- If a host only provides `events.onActivity`, it must still receive compaction
  activity through engine host normalization.
- Keep docs and exports clearly marked alpha.
