# Coding Agent Roadmap

This document turns Heddle's broad framework goal into a concrete execution path.

The immediate proving ground is not "general agents" in the abstract. It is a conversational coding agent runtime that becomes useful enough to help build Heddle itself.

## Why Coding First

Coding is the first hard reference workload because it demands most of the host-framework capabilities that matter elsewhere:

- tool use
- environment access
- safety boundaries
- approval flows
- traceability
- memory and context handling
- verification
- eventually delegation

If Heddle becomes credible for coding work, it becomes much easier to reason about how to adapt the same host architecture to other domains later.

## North Star

Heddle should become a conversational coding agent runtime that is good enough to help build Heddle itself.

This does not require competing with existing commercial products feature-for-feature. It does require building a system that is actually useful in real repository work.

## Phase 0: Conversational Terminal

Goal:

- move from one-shot prompt execution to a conversational terminal interface

Scope:

- terminal UI using Ink
- visible multi-turn conversation
- per-turn tool activity visibility
- session state that carries prior turns into the next run
- basic trace persistence for each turn

Out of scope:

- streaming token rendering
- patch approval workflows
- file editing UX
- subagents

Exit criteria:

- a user can open Heddle in the terminal, ask multiple questions in sequence, and keep the conversation grounded across turns

## Phase 1: Single-Agent Coding Workflow

Goal:

- make Heddle feel like a usable coding assistant instead of a repo Q&A demo

Scope:

- stronger shell and file-action surface
- explicit risky-action approval boundaries
- git-aware repo context
- clearer progress and trace rendering
- interrupt and continue semantics
- better verification-first behavior after edits

Exit criteria:

- Heddle can inspect, edit, verify, and explain bounded changes in a real repository with a usable operator experience

Current progress:

- conversational terminal is working and usable enough for short coding-agent sessions
- shell capability is split into `run_shell_inspect` and `run_shell_mutate`
- `run_shell_mutate` is approval-gated in chat mode
- workspace-changing mutate commands trigger host-side pressure to inspect repo state and run verification before final answer
- chat mode now supports interrupt via `Esc` and resume via `/continue`

Remaining priority:

- stronger git-native review and explanation flow after changes
- clearer summaries of what changed, what was verified, and what remains uncertain
- more polished operator experience around interrupted or resumed runs

## Phase 2: Reliability And Session Quality

Goal:

- make longer interactive sessions stay coherent and recoverable

Scope:

- memory and context compaction
- better blocked-state handling
- improved evidence routing across repo docs and notes
- stronger eval workflow for conversational tasks
- better recovery from tool misuse and ambiguous prompts

Exit criteria:

- multi-turn tool-heavy sessions remain legible and useful instead of degrading quickly

## Phase 3: Serious Coding-Agent Operations

Goal:

- reach the first credible "Claude Code class" workflow shape

Scope:

- background or queued runs
- longer-running command handling
- change summaries and diff-aware review support
- test-failure digestion
- resumable sessions
- richer approval and audit model

Exit criteria:

- Heddle is useful as a regular interface for bounded coding work, not only as an experiment harness

## Phase 4: Delegation And Subagents

Goal:

- add subagents only after the single-agent workflow is already useful

Scope:

- handoffs or agents-as-tools
- bounded child-agent task scoping
- parent and child trace integration
- delegation policy
- user-facing visibility into delegated work

Why this is still high effort even with SDK support:

- provider SDKs can expose the primitive
- Heddle still has to decide when to delegate, how to scope the child, what tools it gets, how results are integrated, and how the user understands what happened

Exit criteria:

- delegation improves real tasks instead of only increasing complexity

## Phase 5: Heddle Builds Heddle

Goal:

- make Heddle the main interface for evolving the Heddle repo

This is not a single implementation milestone. It is the point where the earlier phases are reliable enough that Heddle becomes part of its own development loop.

## Abstractions To Add Only When Needed

The likely useful abstractions are practical, not philosophical:

- session or run model
- environment adapter
- capability classes
- approval policy
- trace and event model
- memory surfaces
- delegation boundary

Heddle should avoid inventing larger cognitive ontologies unless repeated failures justify them.
