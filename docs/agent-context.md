# Shared Agent Context

## Companion Repo

This repo has a sibling companion repo at `../heddle-workspace-notes`.

Purpose:

- `heddle/` is the implementation repo and source of truth for code, tests, examples, and runtime behavior.
- `heddle-workspace-notes/` is the private workspace repo for project memory, planning, analysis, and historical conversations.

## Reading Order

When additional project context is needed, read in this order:

1. `../heddle-workspace-notes/agent-memory/README.md`
2. `../heddle-workspace-notes/agent-memory/current-state/project-summary.md`
3. This repo's docs and code
4. the relevant focused file under `../heddle-workspace-notes/agent-memory/current-state/`
5. `../heddle-workspace-notes/agent-memory/project-context.md` only when broader long-form context is needed
6. `../heddle-workspace-notes/analysis/` and `../heddle-workspace-notes/task-plans/` as supporting historical context only

## Authority Rules

- Treat `../heddle-workspace-notes/agent-memory/README.md` plus `current-state/` as the preferred discovery path for cross-session context.
- Treat `../heddle-workspace-notes/agent-memory/project-context.md` as the broader long-form working summary.
- Treat the live `heddle/` codebase as the implementation truth.
- Treat `../heddle-workspace-notes/analysis/`, `../heddle-workspace-notes/task-plans/`, and `../heddle-workspace-notes/conversations/` as potentially stale historical context unless confirmed against the live repo.

## Working Conventions

- Use `yarn`, not `npm`.
- Use `yarn build` as the canonical type-check.
- Use `yarn test` as the canonical test command.
- Keep changes aligned with the project's minimal-runtime, trace-first philosophy.

## Agent Memory Usage

- `../heddle-workspace-notes/agent-memory/` is writable project memory for CLI agents across sessions.
- Treat `../heddle-workspace-notes/agent-memory/` as cross-tool session memory shared across coding agents such as Cascade/Windsurf, Codex, Claude Code, or similar tools.
- Agents may add or update useful persistent context there when doing so will reduce repeated rediscovery in future sessions.
- Prefer `docs/agent-context.md` for stable shared workflow instructions inside this repo.
- Prefer `../heddle-workspace-notes/agent-memory/` for evolving cross-session memory, project-state notes, and reminders primarily meant for future agents rather than end users.
- Prefer focused files under `../heddle-workspace-notes/agent-memory/current-state/` for active workstream handoff notes instead of putting every update only into `project-context.md`.
- When the user asks to "note this down" or preserve working context, update the most appropriate file in `../heddle-workspace-notes/agent-memory/` unless the information is better treated as stable repo guidance in this repo.
- After meaningful implementation progress, update the relevant task plan, the focused `current-state/` file if one exists, and `../heddle-workspace-notes/agent-memory/project-context.md` if the broader project summary changed.
- Keep agent-memory entries concrete: current repo state, what changed, what remains, verification status, and the next recommended step.

## Maintenance

- After meaningful implementation progress, update the relevant task plan, the relevant focused `current-state/` file, and `../heddle-workspace-notes/agent-memory/project-context.md` when the broader project picture changed.
