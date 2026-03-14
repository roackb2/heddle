# Framework Vision

This document captures Heddle's long-term direction so future contributors and agents can keep local iterations aligned with the real destination.

## End Game

Heddle is meant to become a general agent framework/runtime, not just a code-repo investigator.

The intended stable core is:

- a reusable execution loop
- model adapters
- tool adapters
- traceability and runtime support
- domain-specific extensions built on top of that core

The project should be able to support domains like coding, design, operations, research, or other tool-using workflows without replacing the core run loop each time.

## Current Phase

The project is intentionally not building the full framework top-down.

Current phase:

- prove the minimal execution loop in real tasks
- collect traces
- identify recurring failure modes
- only then promote new abstractions

That means Heddle is deliberately narrower than its final ambition right now.

## Long-Term Capability Areas

Two long-term capability areas matter beyond the basic execution loop.

### Situation Awareness

The agent should eventually have a strong awareness layer for understanding the environment it operates in.

Examples:

- filesystem and repository state
- change awareness through version control
- runtime and infrastructure inspection
- domain-specific environment sensing such as design documents, canvases, or artifact trees

The exact tools will differ by domain, but the framework should support a coherent notion of environment inspection and evidence gathering.

### Knowledge Persistence

The agent should eventually have durable knowledge and context beyond the immediate transcript.

Examples:

- workspace memory for current task artifacts
- domain memory for stable system or product knowledge
- preference memory for user style, conventions, and policies
- learnings from prior runs and feedback
- evolving understanding of how a system or domain behaves

This should not be forced into v0. It is a destination to grow toward once real traces make the need concrete.

## Architectural Direction

The likely long-term shape is:

- core runtime stays small and domain-agnostic
- domains plug in through adapters, toolkits, prompts, traces, and safety policies
- richer capabilities such as awareness and persistence are added as support layers around the loop, not by replacing the loop

In other words, the loop should stay stable while the support system around it becomes more capable.

## Decision Rule

When deciding whether to add a concept now, ask:

- is this part of the long-term destination?
- is it required by repeated failure modes in current traces?

If the first answer is yes but the second is no, document it here and defer implementation.
