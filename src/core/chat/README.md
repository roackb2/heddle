# Chat

The chat domain owns Heddle's persisted conversation/session harness. It turns a
single prompt into a durable chat turn with compaction, leases, memory
maintenance, traces, and host ports.

## Owns

- Chat session storage and catalog persistence.
- Session creation, reading, migration, touching, and summaries.
- Conversation-line projection from model history to user-visible messages.
- Session leases and conflict handling.
- Preflight and final compaction around long histories.
- Ordinary chat turn orchestration through `executeOrdinaryChatTurn`.
- Chat turn persistence: trace file, turn summary, messages, history, context,
  archives, and continuation prompt.
- Host ports for chat-turn events, approvals, and compaction status.

## Does Not Own

- Low-level model/tool step mechanics. Those live in `src/core/agent`.
- General runtime checkpoint/heartbeat APIs. Those live in `src/core/runtime`.
- UI rendering of sessions or events.
- Server routes, React hooks, or Ink components.
- Future slash-command parsing.

## Stable Core Entry Points

- `ordinary-turn.ts`: current conversation-turn harness.
- `session-submit.ts`: server/programmatic submit adapter over ordinary turns.
- `storage.ts`: file-backed chat session store.
- `compaction.ts`: history compaction and archive behavior.
- `conversation-lines.ts`: user-facing chat message projection.
- `turn-host.ts`: semantic host ports for events, approvals, and compaction.

These are stable inside the core codebase, but they are not all exported from
the package root. Package-root exports remain the public npm API.

## Internal Turn Services

- `turn-context.ts`: ordinary turn context preparation, including session,
  runtime, default tool bundle, tool names, and lease owner.
- `turn-runtime.ts`: model, credential, LLM, memory, and system-context
  preparation for ordinary chat turns.
- `turn-memory-maintenance.ts`: inline/background turn memory maintenance and
  trace summary updates.
- `turn-persistence.ts`: final chat turn persistence orchestration, final
  compaction fanout, running-state seeding, and completed session save.
- `session-turn-preflight.ts`: lease acquisition, preflight compaction,
  pre-run compaction-status fanout/running-state seeding, and prepared session
  save before run-loop execution.
- `session-turn-result.ts`: persistence artifacts and final session update.
- `trace.ts`: chat trace persistence. Turn summary formatting lives in
  `src/core/observability/trace-summarizers.ts`.

## Extension Points

- Add host integration through `ChatTurnHostPort` or conversation activity
  projections.
- Add conversation-turn phases as named services before introducing middleware.
- Add compaction behavior through compaction helpers and tests; keep host UI
  rendering outside this domain.
- Add persisted session fields with migration/read compatibility in `storage.ts`.

## Common Changes

- To change turn execution, first decide whether the behavior belongs in
  preflight, run loop, memory maintenance, persistence, or host projection.
- To add a session field, update session types, read/migration logic, projection
  code, and storage tests.
- To add host-visible activity, prefer a core projection helper and let TUI/web
  render the projected activity.

## Tests

- `src/__tests__/integration/chat/chat-runtime.test.ts`
- `src/__tests__/integration/chat/chat-storage.test.ts`
- `src/__tests__/integration/chat/session-submit.test.ts`
- `src/__tests__/unit/chat/chat-format.test.ts`
- `src/__tests__/unit/chat/chat-session-lease.test.ts`

## Notes For Coding Agents

- Treat `ordinary-turn.ts` as the current conversation-engine seam. Keep lease
  cleanup visible there, but put phase-specific mechanics in named turn modules.
- Keep host-specific wording in adapters. Core chat should emit semantics and
  persist durable evidence.
- Do not import from TUI, web, or server code.
