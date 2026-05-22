# Shared Agent Context

This file is the public entry point for coding agents working on Heddle.

Read next:

1. `docs/project-posture.md` for the compact product, architecture, and
   invariant cheat sheet.
2. The live implementation path for the area you are about to change.
3. Nearby tests for the behavior you are touching.

Do not read every doc by default. Use `docs/guides/` for user workflows,
`docs/reference/` for command/config/tool details, `docs/architecture/` for
agreed code boundaries, `docs/strategy/` only for long-term direction, and
`docs/evaluation/` only for eval prompt work.

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
- Use `yarn`; `yarn build` is the canonical type-check and `yarn test` is the
  canonical test command.
- Treat code quality as part of the deliverable. Prefer scoped cleanup alongside
  feature work, but call out broader refactors before expanding scope.
- For non-trivial backend/core work, prefer domain-owned services with clear
  boundaries. A module should own real behavior, not act as a thin wrapper.
- When creating or refactoring core services, use `src/core/chat/engine/` as the
  larger reference pattern together with smaller class-boundary examples such as
  `src/core/tools/`, `src/core/commands/`, `src/core/trace/`, and
  `src/core/review/`: class-based services and repositories when behavior is
  grouped, explicit `types.ts` contracts where a domain has a public shape,
  schema/codec-owned persistence validation, and no loose one-off exported
  domain functions. Add brief class or file-top comments for meaningful classes
  to explain their responsibility and placement boundary.
- Prefer a simple layered split: presentation renders, host/application code
  orchestrates, and core domains own policy and persisted semantics.
- For core dependency direction, follow
  `docs/architecture/core-layering.md`.
- When creating or substantially refactoring a non-trivial service/domain, add
  or update a nearby `README.md` describing responsibility, boundaries, owned
  data/behavior, and where adjacent logic should live. Include a compact
  agent-facing example when it materially helps.
- Use top-level file comments sparingly, only when they clarify responsibility
  or boundary choices that are hard to infer from code.
- Do not re-resolve defaults or fallbacks at every layer. Resolve once at the
  owning boundary, then pass concrete values downward.
- For UI work, default to shadcn UI primitives and Tailwind utility composition;
  prefer migrating touched surfaces toward those primitives over extending
  one-off controls without a concrete product reason.
- For API state and browser interactions, prefer mature ecosystem standards before
  custom implementations. Use established libraries for query/mutation/subscription
  state, date formatting, validation, and common collections where appropriate,
  and only design custom infrastructure for clearly unique requirements.
- In web-v2, session listing and session detail APIs must be accessed through
  React Query + `@trpc/react-query` (including loading/error/cache/subscription
  state), not custom loader hooks that fetch imperatively.
- Before non-trivial features, state the user-facing problem, expected benefit,
  and why the added complexity is justified.
- Do not add safety, coordination, or architectural mechanisms for edge cases
  unless the user has confirmed the pain is real.
- Keep changes aligned with Heddle's minimal-runtime, trace-first philosophy.
- For releases, use annotated tags such as `vX.Y.Z` and write release notes from
  the real git range since the previous tag.

## Public Source Of Truth

For contributors who only have this repo:

1. Read the README and relevant docs in this repository.
2. Inspect the live implementation path for the capability area being changed.
3. Prefer current tests and actual runtime behavior over older comments or stale plans.
4. Keep new durable project guidance in public docs only when it helps future contributors generally.

Do not add maintainer-specific private workflow, personal scheduling, billing, employer, or local-machine instructions to this public repo. Put that kind of material in the developer's own workspace notes instead.
