# Shell Direction

This document defines the next meaningful step for Heddle's execution surface: treating shell as a first-class environment adapter rather than a convenience tool.

It is a product and architecture checkpoint, not a full implementation plan.

## Why This Matters Now

Heddle's current repo-investigator experiments have already done the important early work:

- they proved the minimal loop can run real tasks
- they exposed tool-shape and navigation issues
- they showed where traces are useful

That means the highest-leverage next step is no longer to keep optimizing repository question-answering.

The project's target state is a general tool-using runtime. To move toward that, Heddle needs a credible action surface that can support richer execution and verification tasks across domains.

Shell is the most practical first candidate because:

- many real environments already have mature CLI surfaces
- shell can unlock coding, ops, and investigation workflows without bespoke wrappers for every tool family
- the framework vision already leans toward bounded environment adapters instead of endless tool wrapping

## Current Problem

`run_shell` exists today, but it is still positioned as a read-oriented helper. That is too shallow for the role shell needs to play long term, and its current behavior is also mismatched with its description.

Current weaknesses:

- the product intent is ambiguous
- the safety boundary is not explicit enough
- "read-oriented" does not match all observed behavior
- the current allowlist is a command-prefix filter, not a real capability model

So the next step is to define the product shape of shell clearly before hardening implementation details.

## Product Decision To Make

The immediate question is not "how do we sandbox perfectly?"

It is:

- what kind of shell surface is Heddle actually trying to provide?

There are two viable directions.

### Option A: Read-Only Shell

The shell surface is explicitly for inspection and verification only.

Characteristics:

- read and inspect workspace state
- run commands like `ls`, `cat`, `rg`, `git status`, `git diff`
- never mutate files or external systems

Pros:

- simpler mental model
- easier safety story
- easier to test and reason about

Cons:

- does not unlock real execution workflows
- pushes write/edit/act capability into other tools
- weaker fit for Heddle's long-term role as a general environment runtime

### Option B: Bounded Shell With Explicit Write Capability

The shell surface is a real environment adapter with bounded action capability.

Characteristics:

- supports both inspection and execution
- exposes write capability intentionally rather than accidentally
- separates safe inspection from higher-risk mutation

Pros:

- unlocks richer coding and operational scenarios
- closer to the actual framework vision
- reduces pressure to invent wrappers for every real-world command family

Cons:

- requires a clearer policy model
- requires stronger traceability and limits
- needs explicit semantics around write actions

## Current Recommendation

Bias toward Option B.

Reason:

- Heddle is trying to become a general runtime, not a read-only repo analysis framework
- the broader missing capability is not another retrieval tweak; it is a credible environment action surface
- shell can unlock entirely new classes of behavior, while more repo-investigator tuning mostly improves one narrow example

This does not mean "let the model run arbitrary shell commands."

It means:

- shell should be modeled as a bounded environment surface
- write capability, if present, must be explicit in the contract

## Proposed v1 Shape

The smallest useful next shape is:

- one shell adapter concept
- two explicit capability modes

Example conceptual split:

```ts
type ShellMode = 'inspect' | 'mutate';
```

`inspect` mode:

- read workspace state
- examine git state
- search, diff, summarize, inspect logs or artifacts

`mutate` mode:

- edit files
- run formatting or codegen steps
- possibly invoke bounded operational commands later

The key is not the exact enum. The key is that the capability boundary becomes explicit and traceable.

## Required Runtime Boundaries

Whatever the final API shape is, the shell surface should be bounded by:

- workspace scoping
- allowed command classes
- explicit read vs write semantics
- timeout and output limits
- structured trace output
- clear failure reporting

Possible future additions:

- approval boundary for mutate mode
- mode-specific allowlists
- environment variable policy
- network policy

Those can be phased in later. The first step is to make the capability model explicit.

## What This Unlocks

If Heddle gets shell direction right, it unlocks higher-value next scenarios:

- make a code change, run verification, report result
- inspect git state, make a targeted edit, show diff
- run bounded operational diagnostics
- compare system state before and after an action

Those behaviors are much closer to Heddle's intended end state than further repository-synthesis tuning.

## What Not To Do Next

- do not treat repo-investigator optimization as the main path forward
- do not build a large awareness or persistence subsystem yet
- do not pretend the current `run_shell` prefix filter is already the right long-term abstraction
- do not hardcode repo-specific routing to compensate for missing environment capability

## Immediate Next Design Task

The next concrete step after this document is:

- define `run_shell` v1 semantics in code-level terms

That design should answer:

- is there still one `run_shell` tool, or separate shell tools by mode?
- how is write capability represented?
- what command classes belong in inspect mode vs mutate mode?
- what should traces record for shell actions?
- what behavior requires a stricter boundary later?

That is the right next design step because it can unlock broader agent behavior without prematurely implementing the larger framework layers.
