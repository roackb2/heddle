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
- **Domain / core**: shared behavior whose meaning should stay the same across
  multiple hosts.

If a contributor cannot explain why a piece of logic is specific to one host,
it probably does not belong in that host's controller or view.

## Core Rule

Chat code should follow a strict split:

- **View/presentation** renders state and forwards user intent.
- **Application/controller** orchestrates host flow.
- **Domain/engine** owns semantics, persisted meaning, defaults, fallbacks, and
  reusable policy.

If a behavior has one true meaning across more than one host, it belongs in the
domain/engine layer, not in the view and not duplicated per host.

If a behavior only exists because one host has a particular interaction model,
it may belong in that host's controller.

## Non-Negotiable Rules

- Presentation layers must not own non-UI state.
- Presentation layers must not resolve domain defaults or fallbacks.
- Controllers must not become shadow domain owners.
- Controllers must only own interface-specific wiring.
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
  cli/
    chat/
      README.md                  # host-side TUI rules
      App.tsx                    # presentation composition root
      components/                # pure or near-pure view components
      controllers/               # interface-specific orchestration only
      hooks/                     # UI hooks or controller adapters, not domain owners
      adapters/                  # host-to-domain translation only
      state/                     # UI-only ephemeral state
      utils/                     # presentation helpers only
  web/
    features/
      control-plane/             # same split: view/controller/adapters over domain
```

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
- define any rule that ask mode, web, and TUI should all share.

If the same controller logic would need to be copied into another host, that is
usually a sign it belongs in domain/core instead.

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
