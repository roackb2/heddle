# Core Layering

This document describes the intended dependency shape for Heddle core code. It
is not a full implementation map. It is a placement guide for contributors and
coding agents deciding where behavior belongs.

## Core Rule

Higher layers may depend on lower layers. Lower layers must not depend on
higher layers.

Same-layer domains should avoid importing each other's internals. If two
domains need the same primitive, move that primitive to a lower shared layer or
make the dependency explicit through a public service contract.

## Layer Map

```text
Layer 5: SDK application services and interface adapters
src/sdk, src/cli-v2, src/server, src/web-v2

Layer 4: Product/domain workflows
src/core/chat/engine, src/core/heartbeat, src/core/memory, src/core/awareness,
src/core/review

Layer 3: Runtime host foundation
src/core/runtime

Layer 2: Inner execution engine
src/core/agent

Layer 1: Infrastructure and domain primitives
src/core/llm, src/core/tools, src/core/trace, src/core/auth, src/core/approvals,
src/core/commands

Layer 0: Shared types and utilities
src/core/types, src/core/utils, src/core/config
```

## Runtime Vs Agent

`src/core/agent` is the inner execution loop. It owns model/tool stepping,
streaming callbacks, tool dispatch, low-level trace emission, approval callback
invocation, mutation signals, memory-checkpoint signals, and run completion.

`src/core/runtime` is the host-facing foundation around that loop. It owns
programmatic run entry points, runtime events, checkpoint state, credential
resolution, default tool-bundle assembly, workspace catalog ownership, and
daemon/runtime-host discovery.

The intended direction is:

```text
host surfaces
  -> product/domain workflow
  -> runtime host foundation
  -> inner agent loop
  -> LLM, tools, trace, utilities
```

`src/sdk` is an application boundary over core, not another core domain. It may
compose core services into adopter-facing starting points, but it must not own
persisted meaning or make core depend on SDK host choices. Heddle product apps
remain separate: `src/cli-v2`, `src/server`, and `src/web-v2` own their own
interfaces and workflows.

## Service Shape

For non-trivial core domains, prefer the service shape now used by
`src/core/chat/engine`, `src/core/runtime/workspaces`, and
`src/core/runtime/daemon`:

- a local `README.md` for ownership and boundary rules;
- `types.ts` as the first-read contract;
- `schemas.ts` or a codec class for persisted JSON contracts;
- repository classes for file I/O;
- service/resolver/controller classes for grouped behavior;
- brief file or class comments that explain responsibility;
- no loose one-off exported functions for domain behavior.

Small pure utilities are fine when they are genuinely domain-agnostic. Put them
under a clearly named `utils/` or helper module instead of mixing them with
service behavior. If a utility clearly belongs to one domain, place it in that
domain instead; for example, step-budget behavior lives under `src/core/agent`
rather than generic `src/core/utils`.

## Current Violations And Improvement Areas

These are known cleanup directions, not blockers for every feature:

- Some chat-turn submodules still reach into session repositories directly.
  Prefer moving those flows through the session service boundary when touched.
- `AgentLoopRuntimeService` is correctly above `AgentRunService`, but the name
  can make runtime and agent feel like they both own the same loop. Future
  naming should make the runtime wrapper role clearer.
- `RuntimeToolService` assembles the default tool bundle through the lower-level
  `ToolBundleComposer` contract. Future cleanup should keep runtime policy in
  runtime and low-level duplicate/toolkit checks in `src/core/tools`.
- Interface adapters should continue moving toward "host calls service" rather
  than host-side storage, fallback, or repository access.

When changing one of these areas, prefer a scoped migration that deletes an old
branching path instead of adding a parallel abstraction.
