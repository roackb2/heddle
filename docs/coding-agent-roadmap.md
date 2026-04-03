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
- file creation and editing now have a first-class `edit_file` tool instead of relying only on shell-based file-writing workarounds
- `run_shell_mutate` is approval-gated in chat mode
- shell tools now classify allowed commands by bounded workspace/inspect policy rules and return scope/risk/capability metadata
- unclassified mutate commands now fall back to explicit approval with `unknown` risk metadata instead of immediate rejection
- workspace-changing mutate commands trigger host-side pressure to inspect repo state with concrete git evidence and run verification before final answer
- workspace-changing mutate runs now also require a short operator-style final answer with explicit `Changed`, `Verified`, and `Remaining uncertainty` sections, naming the exact review and verification commands used
- chat mode now supports interrupt via `Esc` and resume via `/continue`
- carried-over session history is sanitized before the next run so interrupted tool calls do not poison later turns with missing tool-output API errors

Remaining priority:

- stronger git-native review flow after changes
- better use of concrete diff/status evidence in those summaries
- more polished operator experience around interrupted or resumed runs, especially clearer separation between active-run state and previously completed turn summaries
- begin evolving shell policy from a narrow command-prefix allowlist toward a real execution-policy model based on risk, scope, approval, and auditability
- reduce reliance on shell-syntax blocking as a safety mechanism; serious workflows will need broader command expressiveness than the current heredoc/redirect restrictions allow
- strengthen host-side follow-through so when the agent discovers a safe path for a bounded change, it executes it instead of stopping at explanation

Direction for shell evolution:

- the current allowlist-based `run_shell_mutate` is a bootstrap, not the intended end state
- serious usefulness requires a bounded general execution surface, not an ever-growing list of specific commands
- future shell policy should classify actions by risk and scope rather than by enumerating all allowed CLIs

Target direction:

- keep `run_shell_inspect` as the low-risk evidence-gathering surface
- evolve mutation/execution into a host-governed policy surface that can eventually support real commands such as project-local scripts, file operations, `aws`, `kubectl`, `gh`, or similar tools when the current environment allows them
- make decisions based on:
  - workspace scope
  - external-system scope
  - destructive risk
  - approval requirement
  - trace/audit requirements

Near-term implication:

- the next shell work should not be "add more prefixes forever"
- it should move toward capability classes and host-side execution policy
- an early step in that direction is now live: mutate policy can classify `yarn run ...` as a project-script capability instead of treating it as only an unknown command

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
- broader policy-based execution surfaces beyond the current narrow mutate allowlist

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
