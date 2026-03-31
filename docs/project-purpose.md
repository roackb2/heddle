# Project Purpose

This document explains why Heddle exists, what it should optimize for, and how to decide which parts of an agent system to build versus borrow.

It is not a detailed architecture spec. It is a stable statement of intent for future contributors and future agent sessions.

## Why Heddle Exists

Heddle exists for two reasons at the same time:

1. to become a serious general agent framework or host runtime
2. to serve as a long-running learning environment for understanding how usable agent systems are actually built

The user's goal is not only to produce a library artifact. The goal is to learn how to build agentic systems that can support real work across domains such as:

- coding
- fintech
- UI/UX design
- marketing
- research
- operations

The target is closer to understanding how to build another Claude Code or Codex class system than to building a toy repo-question-answering loop.

## What "General Agent Framework" Means Here

Heddle is meant to help answer questions like:

- what does a usable agent execution system need in practice?
- what should be owned by the host framework versus delegated to provider SDKs?
- how should tools, environment access, safety boundaries, approvals, memory, and evaluation fit together?
- how do these decisions change across different industries and domains?

The point is not to hard-code one domain. The point is to learn and build the reusable host-side patterns that make agents useful in many domains.

## What Heddle Is Not Trying To Prove

Heddle is not trying to prove that every layer of an agent system must be implemented from scratch.

Rebuilding low-level orchestration only has value when one of these is true:

- the user explicitly wants to understand that mechanism deeply
- provider SDKs are missing an important capability
- provider SDK behavior is too opaque or too weak for the framework's needs

Otherwise, rebuilding foundational orchestration primitives is mostly wheel-reinvention.

## Build Versus Borrow

The default rule is:

- if a capability is becoming a provider-standard primitive, prefer adopting it
- if a capability is where reliability, domain transfer, or product differentiation actually lives, Heddle should own it
- if a capability is educational to rebuild, do so in an isolated learning path rather than forcing the whole framework to stay custom

This distinction matters because the project has two valid paths:

- a framework path for building credible real systems
- a learning path for studying specific mechanisms from first principles

Those paths should inform each other, but they should not be confused with each other.

## What Heddle Should Probably Own

The most durable value in Heddle is likely to come from host-side architecture, not provider-specific model orchestration.

Current likely ownership areas:

- provider abstraction
- tool host and tool safety policy
- shell or computer environment integration
- approval and audit flows
- trace capture, review, and eval workflow
- workspace and domain memory strategy
- delegation policy and subagent topology
- domain adaptation patterns

These are the layers that remain important even if model providers expose stronger built-in orchestration over time.

## What Heddle Should Probably Borrow

Heddle should be willing to rely on provider SDKs for primitives that are already standardizing well.

Examples:

- model-side tool orchestration
- standard shell or computer tool interfaces
- handoffs or agent-as-tool primitives
- session management
- standard tracing surfaces, if they are sufficient

Borrowing these does not reduce Heddle's value. It shifts effort toward the layers that matter more for actual agent systems.

## Why This Still Matters If SDKs Improve

Even if provider SDKs eventually offer more complete primitives for memory, delegation, tracing, or environment access, Heddle still has value.

The enduring questions are not only:

- can a provider call a tool?
- can a model hand off to another model?

The enduring questions are:

- how do you assemble those primitives into a usable system?
- what should be standardized versus domain-specific?
- what safety, evaluation, and operational boundaries make the system trustworthy?
- what changes when moving from coding to design, fintech, or marketing?

Heddle should remain a place to answer those questions through implementation and experiments.

## Relationship To Provider SDKs

The current working assumption is that provider SDKs should be treated as serious building blocks, not automatically as abstractions to avoid.

For example, if OpenAI Agents SDK or other provider SDKs already support:

- shell or computer use
- handoffs
- agents as tools
- human approval flows
- tracing

then Heddle should strongly consider building around those primitives instead of recreating them prematurely.

The key question is not whether a provider SDK contains a feature in name. The key question is whether the feature gives Heddle enough visibility, control, and reliability for the framework's goals.

## Heddle As A Learning Lab

There is still an important place for rebuilding parts of the stack from scratch.

That should happen when the purpose is explicit:

- understand raw execution loops
- understand memory and retrieval tradeoffs
- understand trace schemas
- understand planning and verification policies
- understand how approval or safety semantics work under the hood

The important rule is that these learning exercises should be intentional.

Heddle should not remain permanently low-level just because rebuilding things is educational.

## Practical Decision Rule

When deciding whether to implement a capability inside Heddle or borrow it from a provider SDK, ask:

1. Is this already becoming a stable primitive across providers?
2. Does owning this layer materially improve Heddle's reliability, portability, or domain usefulness?
3. Is rebuilding it necessary for the current learning goal?

If the answer to 1 is yes, and the answers to 2 and 3 are no, Heddle should probably borrow it.

If the answer to 2 or 3 is yes, Heddle should consider owning it.

## Near-Term Implication

Heddle should keep moving toward a serious host framework for agent systems, while remaining willing to evaluate SDK-backed orchestration paths rather than overcommitting to a custom raw loop.

That means:

- keep trace-driven learning
- keep domain-agnostic runtime thinking
- keep evaluating environment and delegation patterns
- avoid mistaking custom orchestration for intrinsic framework value

The long-term goal is not "build everything ourselves."

The long-term goal is "understand and build agent systems that actually work."
