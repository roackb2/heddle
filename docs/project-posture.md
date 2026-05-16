# Heddle Project Posture

This is the short orientation doc for coding agents working in Heddle. Read it
after `docs/agent-context.md` and before changing non-trivial behavior.
`HEDDLE.md` is the Heddle-native project instruction entrypoint and should stay
small enough to route agents here instead of duplicating this document.

## Identity

Heddle is a local-first TypeScript agent runtime and developer tool for durable
coding-agent work. It combines a reusable execution loop, local tools,
approvals, traces, saved sessions, memory, heartbeat tasks, and a browser
control plane.

The current proving ground is single-agent coding work. The broader direction
is a general host framework for useful agent systems: environment access,
tooling, approval policy, memory, situation awareness, traces, and evaluation.

## Product Posture

- Keep Heddle minimal, trace-first, and operator-controlled.
- Prefer observable state and explicit tools over hidden magic.
- Let agents use intelligence to explain intent, but keep policy decisions in
  runtime/operator control.
- Use memory and workspace notes for routing and context; use live code and
  tests as the source of truth.
- Build host-side patterns that transfer across domains. Do not overfit Heddle
  to TypeScript, this repository, or one maintainer workflow.

## Invariants

- Heddle is language-agnostic. Search, tools, approvals, and UX must not assume
  JS/TS projects unless a feature explicitly targets JS/TS.
- Approval UI must reflect what the runtime can actually store or enforce.
- Remember options should be few, understandable, and safe to broaden.
- Tool behavior should be explainable from traces and user-visible prompts.
- Fallback paths matter when implementation has multiple backends.
- Prefer mature domain tools over custom parsing when those tools already own
  the hard behavior.
- Prefer domain-owned services with clear responsibility boundaries for
  non-trivial backend behavior. Do not spread one domain's logic across hosts,
  adapters, and generic helpers when a focused service/module can own it.
- Keep layering simple and legible: presentation surfaces render state,
  application/controller layers orchestrate user intent, and core domains own
  semantics, policy, and persisted meaning.
- A module boundary earns its place only when it owns meaningful behavior.
  Wrapper-only pass-through layers are not architecture progress.
- Resolve defaults and fallbacks in one owning domain whenever possible. Avoid
  the pattern where hosts, hooks, and leaf helpers all repeat `x ?? y ?? z`
  and each layer partially re-decides behavior.
- Private workspace notes are optional. Public Heddle behavior must not depend
  on private files.
- Do not trade code quality for feature speed in touched areas. Scoped cleanup
  is part of finishing the feature.

## Architecture Map

- `src/core/runtime/` owns agent runtime boundaries, heartbeat, default tools,
  and host-facing execution.
- `src/core/chat/engine/` owns persisted conversation sessions, turns,
  compaction, leases, approvals, traces, and package-level programmatic use.
- `src/core/chat/` defines the shared chat boundary and layering guidance above
  the engine. It should stay small.
- `src/core/tools/` owns tool definitions, registries, execution, and toolkits.
- `src/core/approvals/` owns approval policy chains and remembered rules.
- `src/core/observability/` owns trace and activity projection.
- `src/cli/` owns terminal and TUI host surfaces.
- `src/server/` owns the daemon/control-plane API.
- `src/web/` owns the browser control plane.
- `src/__tests__/unit/` and `src/__tests__/integration/` hold behavior locks
  for touched paths.
- `docs/` is the public contributor source of truth.

Within those areas, prefer subdomains/services that are easy to identify and
review. A good service boundary should make it obvious:

- what responsibility the module owns;
- what data or state it gathers, translates, or persists;
- what behavior still belongs outside the module;
- which tests lock its behavior;
- where to extend the feature next.

For host-heavy areas, prefer an MVC-like split that stays easy to reason about:

- view/presentation renders state;
- application/controller code wires user actions and host lifecycle;
- domain modules decide the actual behavior.

For non-trivial services, keep a local `README.md` near the implementation when
it materially improves ownership clarity for future contributors and coding
agents.

## Before Editing

For non-trivial work:

1. Restate the user-facing problem and why it matters.
2. Inspect the live implementation path before proposing code.
3. Check nearby tests and add focused coverage for the actual risk.
4. Challenge project invariants: language assumptions, fallback behavior,
   approval truthfulness, trace visibility, and unnecessary complexity.
5. Prefer a simple local change that matches existing ownership boundaries.
6. Verify with targeted tests and `yarn build` when the change touches public
   API, package behavior, or web/client code.

If the change reveals a broader architectural problem, say so before expanding
scope.

## Common Discovery Paths

- Agent loop and runtime: `src/core/runtime/agent-loop.ts`,
  `src/core/agent/service.ts`, `src/core/runtime/default-tools.ts`.
- Tool behavior: `src/core/tools/toolkits/`, `src/core/tools/registry.ts`,
  `src/core/tools/execute-tool.ts`.
- Shell and approvals: `src/core/tools/toolkits/shell-process/`,
  `src/core/approvals/`.
- TUI approvals and chat: `src/cli/chat/`.
- Control plane: `src/server/features/control-plane/`,
  `src/web/features/control-plane/`.
- Memory: `src/core/tools/toolkits/knowledge/`, `src/core/memory/`.
- Project direction: `docs/strategy/project-purpose.md`,
  `docs/strategy/framework-vision.md`.

Keep this doc concise. If a detail becomes large or task-specific, put it in a
focused guide, reference doc, test, or task plan instead.
