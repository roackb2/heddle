# Heddle Core Refactor Roadmap: Phase B TUI Adapter Milestone

This eval fixture is a public, self-contained slice of the Heddle core refactor
roadmap. It exists so the dogfood eval can be run by any developer without
access to private workspace notes.

## Product Goal

Heddle should behave like a reusable conversation and execution engine that can
power multiple host applications. The terminal UI is one host. The browser
control plane is another host. Future applications should be able to consume the
same core runtime without copying TUI-specific workflow rules.

The architectural direction is:

- `src/core`: shared runtime, chat/session semantics, tools, prompts, traces,
  model adapters, and reusable workflow logic
- `src/cli`: terminal-specific rendering, keyboard handling, local TUI state,
  approval UI, and adapter code
- `src/server`: daemon/control-plane transport and server host adapters
- `src/web`: browser UI and browser-side state/rendering

## Phase B Goal

Thin the TUI into an adapter over the shared core chat runtime.

`src/cli/chat/hooks/useAgentRun.ts` should mainly compose runtime dependencies
and dispatch user actions. It should not own large chunks of workflow behavior
that can be isolated into focused TUI adapter modules or shared core modules.

The purpose is not cosmetic file movement. The purpose is to make it easier to
see which behavior is:

- shared Heddle conversation/session semantics
- terminal-host adaptation
- terminal presentation/finalization
- local command handling
- approval or run-loop-event presentation

## Milestone To Complete

Complete one cohesive Phase B milestone:

1. Inspect `src/cli/chat/hooks/useAgentRun.ts` and nearby TUI hook modules.
2. Pick one TUI concern that is still too large, too mixed, or too hidden inside
   `useAgentRun`.
3. Extract that concern into focused module(s) under `src/cli/chat/hooks`.
4. Update `useAgentRun` to delegate to those module(s).
5. Keep shared conversation/session semantics in `src/core/chat`; do not move
   shared workflow rules back into TUI code.
6. Add or update focused tests that would catch behavior drift.
7. Run targeted tests and finish with an honest summary of completed work and
   remaining risk.

Good candidate concerns include:

- ordinary-turn host adaptation
- direct-shell execution and finalization
- compaction status handling
- run-loop event handling
- turn-result finalization
- top-level lifecycle cleanup around an agent run

## Expected Shape Of A Good Diff

A good solution is a real multi-file refactor, not a one-line cleanup.

Expected signals:

- `src/cli/chat/hooks/useAgentRun.ts` changes and becomes easier to scan
- at least one focused TUI hook module is added or meaningfully updated
- focused tests are added or updated under `src/__tests__/chat` or a nearby
  relevant test folder
- shared runtime code under `src/core/chat` is only changed if the boundary
  genuinely needs it
- the diff avoids unrelated UI redesign, provider/auth changes, or broad folder
  migration

## Scope Boundaries

Allowed:

- `src/cli/chat/hooks/useAgentRun.ts`
- `src/cli/chat/hooks/tui-*.ts`
- `src/cli/chat/hooks/usePromptSubmission.ts`
- `src/cli/chat/utils/runtime.ts`
- focused shared-chat code under `src/core/chat/*.ts` when needed
- focused tests under `src/__tests__/chat/*.test.ts` or
  `src/__tests__/tools/*.test.ts`

Out of scope:

- browser UI redesign
- TUI rendering redesign unrelated to the extracted concern
- provider/auth changes
- broad Phase D folder migration
- eval harness changes inside this target workspace

## Verification

Run meaningful targeted tests. A good default is:

```bash
yarn vitest run src/__tests__/chat/chat-runtime.test.ts src/__tests__/chat/chat-format.test.ts src/__tests__/tools/tools.test.ts
```

If the selected concern has a more focused test, run that too.

## Completion Bar

This milestone is complete enough for review when:

- `useAgentRun` delegates one cohesive concern instead of owning it directly
- the extracted module boundary is understandable
- tests cover the behavior that could regress
- targeted tests pass
- the final summary names changed files, verification, and any remaining Phase B
  follow-up without claiming the entire roadmap is complete
