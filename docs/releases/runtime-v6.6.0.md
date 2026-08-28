# `@heddleagent/runtime` 6.6.0

This release completes Heddle's core provider-neutral subagent capability for
products embedding the conversation SDK.

## What changed

- conversation turns make bounded delegation available by default while
  preserving engine- and turn-level `off` controls;
- roots can delegate read-only work to Ask or Review children and may
  explicitly grant a Code child the exact workspace and shell tools already
  available to the root;
- Code actions use the root's existing approval policies and host approval
  callback, with no second subagent permission system;
- action-capable children serialize within a root scope, while bounded
  read-only children may run concurrently;
- correlated child lifecycle/activity is exposed through the existing host
  stream, and sanitized settled records persist with the parent turn; and
- `ConversationAgentService` returns child evidence through
  `result.delegation`, so SDK adopters can render or project subagent work
  without reconstructing it from tool text.

## Upgrade note

No per-turn enable call is required. The root model decides when delegation is
useful. A host can disable it globally with engine delegation mode `off`, or a
caller can pass `delegation: 'off'` for one turn.

Subagents remain depth-one and same-workspace. Browser, MCP, skills, memory,
artifacts, recursive delegation, per-child worktrees, and distributed workers
are not implicitly granted to children.

## Verification

- PRs #371 through #375 are included in the release range;
- real terminal, web, and public-SDK runs completed approved Code-child edits
  and verified the resulting bytes; and
- the SDK path returned correlated child activity plus settled records while a
  deny-path run changed no workspace file.
