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

## Original System Shape

The original target shape for a general agentic system had three major pillars:

- execution loop
- situation awareness
- knowledge persistence

Those ideas remain part of the destination, even though Heddle is only implementing the minimal loop first.

A current boundary sketch for awareness and persistence lives in [docs/awareness-and-memory.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/awareness-and-memory.md).

### Execution Loop

The long-term execution pattern is broader than the current v0 loop:

- requirement
- information gathering
- plan
- review
- execution
- verify

Heddle should not hard-code that full structure into the runtime yet, but it is still a useful picture of the eventual operating model.

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

Target capabilities:

- holistic view through mature tools such as `ls -r`, `grep`, `cat`, `find`, `sort`, `jq`
- change awareness through tools like `git`
- inspection of external systems
- infrastructure inspection such as `aws-cli` or `kubectl`
- system inspection such as logs and metrics
- domain-specific environment sensing such as design documents, canvases, or artifact trees

The exact tools will differ by domain, but the framework should support a coherent notion of environment inspection and evidence gathering.

### Knowledge Persistence

The agent should eventually have durable knowledge and context beyond the immediate transcript.

Target memory layers:

- workspace memory for current task artifacts such as plans, analysis, reports, and notes
- domain memory for stable system or product knowledge such as service readmes
- preference memory for tone, security policy, and conventions
- learnings from prior interactions and feedback
- understanding as a continuously refined model of how the system or domain behaves

This should not be forced into v0. It is a destination to grow toward once real traces make the need concrete.

## Tool Philosophy

One important part of the long-term direction is to avoid increasing agent cognitive load by inventing unnecessary tool abstractions.

The preference is:

- reuse mature tools humans already use in real work whenever possible
- avoid redundant wrapper abstractions unless they clearly reduce recurring failure modes
- let domain adapters expose real capabilities without forcing every domain into the same artificial tool vocabulary

The stronger rule is:

- agent-facing tools should have simple mental models and predictable behavior
- architecture terminology should stay mostly internal unless it is also behaviorally clear at the tool boundary
- heuristic tools should declare themselves as suggestions rather than pretending to be exhaustive search or proof
- heuristic outputs should be easy to verify with simpler deterministic tools

The current product tension is between:

- adding structured tools with very clear semantics
- relying on a safe shell environment that exposes mature existing tools directly

The current leaning is:

- keep a small set of high-frequency structured tools where they clearly improve clarity, safety, or reliability
- avoid wrapping every ecosystem CLI or infrastructure command family into bespoke Heddle tools
- invest in a safe, well-bounded shell environment so agents can use mature tools like `grep`, `git`, `aws`, or `kubectl` directly when appropriate

For code and repo work, this means tools like file inspection, grep, git, and shell access are not incidental conveniences. They are examples of the broader principle that the agent should be able to act through practical, reality-based interfaces.

## Architectural Direction

The likely long-term shape is:

- core runtime stays small and domain-agnostic
- domains plug in through adapters, toolkits, prompts, traces, and safety policies
- richer capabilities such as awareness and persistence are added as support layers around the loop, not by replacing the loop

In other words, the loop should stay stable while the support system around it becomes more capable.

## Mid-Term Environment Roadmap

One likely mid-term direction is to treat sandboxed shell execution as a more first-class environment surface rather than encoding every capability as a bespoke tool.

The intended stance is:

- keep a small number of structured tools where they add clarity or safety
- improve shell execution as a realistic environment adapter for domains that already have strong CLI workflows
- let future domains use other environment adapters where shell is a poor fit, such as design APIs or visual tools

Structured tools should be biased toward high-frequency CRUD-style operations with simple semantics, such as listing, reading, or searching common artifacts. Shell should cover the long tail and domain-specific edge cases where wrapping every capability would create unnecessary abstraction debt.

This still fits Heddle's overall goal. A sandboxed shell is not a deviation from the framework direction; it is one plausible action surface inside that framework.

A current design checkpoint for that direction lives in [docs/shell-direction.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/shell-direction.md).

What matters is that shell execution be bounded by runtime support:

- workspace scoping
- safety policy
- traceability
- resource limits
- approval or capability boundaries where needed

That means the long-term framework should support both:

- structured tools
- richer environment adapters such as shell, browser, or domain-specific APIs

## Decision Rule

When deciding whether to add a concept now, ask:

- is this part of the long-term destination?
- is it required by repeated failure modes in current traces?

If the first answer is yes but the second is no, document it here and defer implementation.
