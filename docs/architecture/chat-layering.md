# Chat Layering

This document defines the target layering for Heddle chat surfaces.

The goal is to make the codebase easy to reason about in the same way mature
frameworks make placement obvious: when a feature touches chat, a contributor
should know where the code belongs before they start wiring it.

## Terminology

- **Host**: a concrete user interaction surface such as the TUI, web control
  plane, ask mode, daemon API, or a future programmatic surface.
- **View / presentation**: code that renders UI state and captures user intent
  for one host.
- **Controller**: interface-specific orchestration that wires one host's events,
  lifecycle, and UI flow to domain behavior.
- **Hook**: a React delivery form used by React-based hosts. A hook may
  implement controller behavior or UI-local state, so naming and docs must make
  the role explicit.
- **Domain / core**: shared behavior whose meaning should stay the same across
  multiple hosts.

If a contributor cannot explain why a piece of logic is specific to one host,
it probably does not belong in that host's controller or view.

## Top-Level Direction

The intended long-term repo shape is:

```text
src/
  core/        # shared domain behavior and reusable runtime capabilities
  apps/        # user-facing interface surfaces
    cli/       # terminal/TUI interface
    web/       # browser interface
  server/      # transport/control-plane serving layer over core capabilities
```

The point of this split is to make the ownership obvious:

- `src/core` is the shared system.
- `src/apps/cli` and `src/apps/web` are two different interfaces over that
  shared system.
- `src/server` is not a third product surface. It serves core capabilities to
  the web/control-plane side of the system.

The current repository is not fully in this shape yet. Treat this as the target
direction for future refactors in touched areas.

## Core Rule

Chat code should follow a strict split:

- **View/presentation** renders state and forwards user intent.
- **Application/controller** orchestrates host flow.
- **Domain/engine** owns semantics, persisted meaning, defaults, fallbacks, and
  reusable policy.

Hosts should call core services, not repositories or storage helpers directly.
In a local host like the TUI, that means direct service calls instead of API
calls; in a remote host like web, that likely means an API. The boundary rule
is the same in both cases: hosts talk to services, and services talk to
repositories/storage.

If a behavior has one true meaning across more than one host, it belongs in the
domain/engine layer, not in the view and not duplicated per host.

If a behavior only exists because one host has a particular interaction model,
it may belong in that host's controller.

For React-based hosts, the practical relationship is:

- controller is a role
- hook is the implementation shape

So a React host may express controller logic as `use...Controller` hooks inside
its `hooks/` layer.

## Non-Negotiable Rules

- Presentation layers must not own non-UI state.
- Presentation layers must not resolve domain defaults or fallbacks.
- Controllers must not become shadow domain owners.
- Controllers must only own interface-specific wiring.
- Hooks must not be used to hide domain ownership.
- Domain owners should resolve effective behavior once, then pass concrete
  values downward.
- Repeated `x ?? y ?? z` across view, hooks, controllers, and services is a
  design smell to remove.

## Intended Folder Shape

This is the rough target shape, not a requirement to rewrite everything at
once:

```text
src/
  core/
    chat/
      README.md                  # boundary and layering rules
      types.ts                   # shared persisted chat contracts
      engine/                    # domain owner for persisted chat semantics
        README.md
        config.ts
        conversation-engine.ts
        sessions/
          service.ts
          preferences/
            service.ts
        turns/
          service.ts
          ...
  apps/
    cli/
      chat/
        README.md                # host-side CLI/TUI rules
        App.tsx                  # presentation composition root
        components/              # pure or near-pure view components
        hooks/                   # React host layer: controller hooks plus UI-local hooks
          controllers/           # optional subfolder for obvious flow owners
        adapters/                # host-to-domain translation only
        state/                   # UI-only ephemeral state
        utils/                   # presentation helpers only
    web/
      features/
        control-plane/
          components/            # pure or near-pure view components
          hooks/                 # React host layer: controller hooks plus UI-local hooks
            controllers/         # optional subfolder for obvious flow owners
          adapters/              # web-to-core translation only
          state/                 # UI-only ephemeral state
          utils/                 # presentation helpers only
  server/
    features/
      control-plane/             # transport layer exposing core capabilities
```

## Current vs Target

Today, some interface code still lives under paths like `src/cli/` and
`src/web/`. That is current structure, not the desired final shape.

When future refactors touch these areas:

- prefer moving shared behavior inward toward `src/core`
- prefer moving interface-only behavior toward `src/apps/cli` or
  `src/apps/web`
- do not move behavior sideways between interfaces when it really belongs in
  core

The CLI still does too much today. The direction is to keep pushing shared
logic into core so the CLI becomes a thinner interface layer over time.

## Interface-Level Shape

Inside each interface app, prefer this local split:

- `components/`: rendering and UI widgets
- `hooks/`: React host layer containing both controller hooks and UI-local hooks
- `adapters/`: translation between interface events/data and core contracts
- `state/`: ephemeral UI-only state
- `utils/`: presentation helpers only

For readability, a React host may also use:

- `hooks/controllers/` for obvious flow owners

That is still one hook layer, not a separate architecture tier.

## What Should Go Where

### View / Presentation

Examples:

- layout
- panels
- input widgets
- picker rendering
- footer text
- keybinding-driven UI visibility

The view may own ephemeral UI state such as:

- focus
- highlighted index
- panel open/closed state
- scroll position
- draft text before submission

The view must not own:

- persisted session semantics
- active-model meaning
- reasoning inheritance/default rules
- compaction policy
- approval policy
- trace policy

### Application / Controller

Examples:

- session switch flow
- prompt submission flow
- run lifecycle wiring
- TUI event handling that coordinates multiple view pieces
- host-side batching or sequencing around engine calls
- adapting engine events into one host's render/update flow
- coordinating one host's pending/loading UX around domain actions

Controllers may compose multiple domain calls, but they should not redefine the
meaning of the underlying state.

If a controller starts deciding defaults, resolving effective policy, or
explaining what a persisted field "really means," the ownership is in the wrong
place.

Controllers earn their place only when the logic is genuinely interface
specific.

Good controller responsibilities:

- map a TUI keybinding flow to engine actions;
- coordinate panel state around a session switch in the TUI;
- adapt streaming activity into one host's update flow;
- sequence host-local UX steps around a user action.

Bad controller responsibilities:

- decide what a session stores;
- resolve model or reasoning inheritance;
- define approval policy;
- define compaction behavior;
- define trace semantics;
- call repositories or file storage directly;
- define any rule that ask mode, web, and TUI should all share.

If the same controller logic would need to be copied into another host, that is
usually a sign it belongs in domain/core instead.

### Hooks

Hooks are an implementation shape. In React-based hosts, they are the real host
integration layer.

Good hook responsibilities:

- local draft state
- local picker state
- controller hooks for interface-specific orchestration
- React-friendly adapters around core outputs
- UI-only convenience state derived for rendering

Bad hook responsibilities:

- re-resolving shared defaults/fallbacks
- owning persisted semantics
- pretending there is a second architecture layer just because the file system
  has another folder

If a hook owns interface-specific orchestration, name it explicitly as a
controller hook: `use...Controller`.

If the host grows enough that the top-level `hooks/` folder becomes noisy,
group obvious controller hooks under `hooks/controllers/` before inventing a
second parallel architecture layer.

### Domain / Engine

Examples:

- what a session stores
- how a new session inherits preferences
- what reasoning effort is effectively in force
- how turns persist
- how compaction works
- how trace events are shaped

This layer should answer the questions that every host would otherwise
rediscover.

Examples of shared questions the domain should answer once:

- what a session stores;
- what effective reasoning effort is in force;
- how a new session inherits preferences;
- what approval state means;
- how compaction should run;
- what trace events exist and what they mean.

The current `src/core/chat/engine/` services are the reference code structure
for this layer. When adding a new service or refactoring an existing one, prefer
the engine pattern that has emerged there:

- a local `README.md` for service boundary and placement rules;
- `types.ts` files as the read-first contract;
- class-based services and repositories for grouped stateful behavior;
- schema/codec classes or mature validators for persisted disk contracts;
- static class methods for pure domain behavior that still belongs to the
  domain;
- brief class or file-top comments explaining what meaningful classes own;
- no loose one-off exported functions for service/domain behavior.

## Refactor Direction

Do not pause feature development for a total rewrite. Use feature work to move
touched areas toward this shape:

1. identify the duplicated decision;
2. choose the real owner;
3. move the policy there;
4. delete host-side re-resolution;
5. keep the host thinner than before.

## Why This Lives In The Public Repo

This guidance belongs in the public repo because it defines contributor-facing
architecture, not maintainer-private workflow.

The workspace-notes repo can carry stronger reminders about current pain points
or active refactor priorities, but the canonical layering rule should stay
visible to any future contributor or coding agent working only from this
repository.
