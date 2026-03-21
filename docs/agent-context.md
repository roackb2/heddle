# Shared Agent Context

## Companion Repo

This repo has a sibling companion repo at `../heddle-workspace-notes`.

Purpose:

- `heddle/` is the implementation repo and source of truth for code, tests, examples, and runtime behavior.
- `heddle-workspace-notes/` is the private workspace repo for project memory, planning, analysis, and historical conversations.

## Reading Order

When additional project context is needed, read in this order:

1. `../heddle-workspace-notes/agent-memory/project-context.md`
2. This repo's docs and code
3. `../heddle-workspace-notes/analysis/` and `../heddle-workspace-notes/task-plans/` as supporting historical context only

## Authority Rules

- Treat `../heddle-workspace-notes/agent-memory/project-context.md` as the most useful cross-session working summary.
- Treat the live `heddle/` codebase as the implementation truth.
- Treat `../heddle-workspace-notes/analysis/`, `../heddle-workspace-notes/task-plans/`, and `../heddle-workspace-notes/conversations/` as potentially stale historical context unless confirmed against the live repo.

## Working Conventions

- Use `yarn`, not `npm`.
- Use `yarn build` as the canonical type-check.
- Use `yarn test` as the canonical test command.
- Keep changes aligned with the project's minimal-runtime, trace-first philosophy.

## Agent Memory Usage

- `../heddle-workspace-notes/agent-memory/` is writable project memory for CLI agents across sessions.
- Agents may add or update useful persistent context there when doing so will reduce repeated rediscovery in future sessions.
- Prefer `docs/agent-context.md` for stable shared workflow instructions inside this repo.
- Prefer `../heddle-workspace-notes/agent-memory/` for evolving cross-session memory, project-state notes, and reminders primarily meant for future agents rather than end users.
- When the user asks to "note this down" or preserve working context, update the most appropriate file in `../heddle-workspace-notes/agent-memory/` unless the information is better treated as stable repo guidance in this repo.

## Maintenance

After meaningful implementation progress, update `../heddle-workspace-notes/agent-memory/project-context.md` so future CLI agent sessions can recover current context quickly.
