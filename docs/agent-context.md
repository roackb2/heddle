# Shared Agent Context

This file is the public entry point for coding agents working on Heddle.

Read next:

1. `docs/project-posture.md` for the compact product, architecture, and
   invariant cheat sheet.
2. The live implementation path for the area you are about to change.
3. Nearby tests for the behavior you are touching.

Do not read every doc by default. Use `docs/guides/` for user workflows,
`docs/reference/` for command/config/tool details, `docs/strategy/` only for
long-term direction or architecture tradeoffs, and `docs/evaluation/` only for
eval prompt work.

Heddle is an open-source project. Do not assume that every contributor has access to the original maintainer's private planning notes, local memory, or companion repositories.

## Optional Workspace Notes

Some developers may keep a private companion notes repo next to this checkout, commonly named something like:

```text
heddle/                  # the public implementation repo
heddle-workspace-notes/  # optional private notes, plans, and agent memory
```

If such a repo exists in the developer's workspace, agents may use it for extra context. If it is absent, continue using only this repo's docs and live code. The companion notes repo is an optional productivity pattern, not a requirement for contributing to Heddle.

Recommended, non-binding folder shape for developers who want one:

```text
agent-memory/
  README.md
  current-state/
  workflows/
  history/
task-plans/
  features/
  enhancements/
  refactoring/
  integrations/
  research/
  done/
analysis/
conversations/
tool-understanding/
local/
  agent-memory-private/
```

Developers are free to structure their private notes differently. The goal is to improve multi-session coding-agent performance by giving agents durable, developer-owned context without putting personal workflow details into the public Heddle repo.

When a companion notes repo is present, treat the live Heddle codebase as the implementation source of truth. Notes are useful for routing, planning, and history, but they can drift from the code.

## Working Conventions

- Read `docs/project-posture.md` before non-trivial implementation work.
- Use `yarn`, not `npm`.
- Use `yarn build` as the canonical type-check.
- Use `yarn test` as the canonical test command.
- Prefer scoped refactoring alongside feature work. Each feature should leave the touched code cleaner, easier to maintain, more structured, and named more clearly than before.
- Do not ship features by trading implementation speed for code quality regression. Avoid accumulating tech debt in touched areas when a scoped cleanup is practical.
- If a feature reveals that broader refactoring is needed, call it out explicitly before expanding scope.
- Coding agents should treat code quality as part of the deliverable, not optional polish. A completed feature should improve product behavior and maintainability together.
- For web/mobile UI work, default to shadcn UI primitives and Tailwind utility composition for standard interaction behavior and design language.
- When touching an existing UI surface, prefer migrating the touched area toward shadcn primitives instead of extending custom one-off controls unless there is a concrete product reason not to.
- Before building any non-trivial feature, state the user-facing problem, the expected user benefit, and why the feature is worth the added complexity. If that case is weak, stop and discuss before implementing.
- Do not build safety, presence, ownership, or coordination mechanisms for corner cases unless the user has confirmed the pain is real enough to matter in actual usage.
- Do not optimize for internal architectural consistency over user value. Product usefulness and real user workflow take precedence over neat mechanism design.
- For user-facing releases, use an annotated git tag such as `vX.Y.Z` on the actual release commit.
- Write release notes from the real git range since the previous release tag, not from commit-prefix inference alone.
- Keep changes aligned with the project's minimal-runtime, trace-first philosophy.

## Public Source Of Truth

For contributors who only have this repo:

1. Read the README and relevant docs in this repository.
2. Inspect the live implementation path for the capability area being changed.
3. Prefer current tests and actual runtime behavior over older comments or stale plans.
4. Keep new durable project guidance in public docs only when it helps future contributors generally.

Do not add maintainer-specific private workflow, personal scheduling, billing, employer, or local-machine instructions to this public repo. Put that kind of material in the developer's own workspace notes instead.
