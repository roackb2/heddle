# Run Shell v1 Contract

This document defines the proposed v1 contract for Heddle's shell environment surface.

It follows the direction in [docs/shell-direction.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/shell-direction.md) and answers the next concrete design question:

- what should `run_shell` mean as a bounded environment adapter?

This is still a design document. It does not require immediate implementation.

## Design Goal

Make shell capability explicit enough that:

- agents can predict what kind of action surface they are using
- library authors can reason about safety and traceability
- Heddle can unlock richer execution tasks without pretending to have a complete sandbox

## Recommendation

Keep one shell adapter concept, but split capability explicitly at the tool boundary.

Recommended shape:

- `run_shell_inspect`
- `run_shell_mutate`

Why separate tools instead of a `mode` field on one tool:

- the agent-facing mental model is clearer
- safety intent is visible in the tool name
- descriptions and examples can be mode-specific
- traces become easier to interpret
- approval/policy can evolve independently later

This is better than one overloaded `run_shell` tool because the two modes have materially different risk and purpose.

## Tool 1: `run_shell_inspect`

Purpose:

- inspect, search, compare, and verify environment state

Allowed intent:

- list files and directories
- read file content through shell utilities
- search text
- inspect git state
- compute summaries or diffs
- inspect non-mutating metadata

Example command classes:

- `ls`, `cat`, `head`, `tail`, `wc`
- `grep`, `rg`, `find`, `sort`, `uniq`, `jq`
- `pwd`, `which`, `file`, `tree`, `du`, `df`
- `git status`, `git diff`, `git show`, `git log`, `git grep`, `git ls-files`, `git rev-parse`

Non-goals:

- file mutation
- code formatting
- dependency installation
- networked operational changes

Agent-facing mental model:

- "safe inspection tool for CLI-native evidence gathering"

## Tool 2: `run_shell_mutate`

Purpose:

- perform bounded workspace mutations and related verification steps

Allowed intent:

- edit files in the workspace
- run formatting or code generation commands
- run tests or verification commands that may write local build artifacts

Example command classes:

- file edits through approved command classes
- formatters
- test runners
- project-local code generation

Non-goals in v1:

- arbitrary system mutation
- package installation by default
- networked infrastructure changes
- destructive repo operations

Agent-facing mental model:

- "bounded workspace action tool; use only when inspection is not enough"

## Why This Split Matters

This separation solves a real ambiguity in the current design.

Today:

- `run_shell` is described as read-oriented
- but its actual behavior can mutate files

That mismatch makes the tool hard to reason about for both the agent and the framework author.

Two explicit tools make the contract legible:

- inspection is normal evidence gathering
- mutation is a different capability with different consequences

## Shared Input Shape

Both tools can keep the same minimal input:

```ts
type RunShellInput = {
  command: string;
};
```

This is good enough for v1 because:

- agents already understand shell commands
- the main missing piece is capability clarity, not a more complex input schema

## Shared Output Shape

Both tools should continue returning structured output:

```ts
type RunShellOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};
```

This is already a good contract because it mirrors real CLI expectations and keeps traces legible.

## Required Runtime Boundaries For v1

### Workspace Scope

Commands should be scoped to the current workspace root.

For mutate mode, the boundary should be stricter:

- only workspace-relative mutation
- no writes outside the workspace

### Command-Class Policy

Policy should move from "string prefix allowlist" toward "capability class" thinking.

For example:

- inspect class
- mutate class
- verify class

The implementation may still use allowlists initially, but the contract should describe capability classes, not just raw prefixes.

### Control Operators

Continue blocking shell control operators in v1:

- pipes
- redirects
- chaining
- subshells

Reason:

- this keeps commands easier to inspect and trace
- it reduces accidental complexity while the shell surface is still maturing

This is a deliberate simplification, not a statement that Heddle will never support richer shell composition.

### Resource Limits

Both tools should have:

- execution timeout
- output size limit
- explicit non-zero exit handling

Mutate mode may later need stricter defaults than inspect mode.

## Trace Requirements

Shell actions are only useful as a framework surface if traces remain strong.

Minimum trace expectations:

- tool name used (`run_shell_inspect` vs `run_shell_mutate`)
- exact command
- exit code
- stdout/stderr
- whether the action was inspection or mutation by contract

The current structured output already covers most of this.

## What To Defer

Do not solve these in the same step:

- full sandboxing
- network policy
- privilege escalation model
- package installation policy
- infrastructure mutation policy
- approval UX

Those are future layers. v1 only needs to make shell capability explicit and legible.

## Recommended v1 Implementation Order

1. split the current tool into explicit inspect and mutate variants
2. keep input/output simple
3. tighten the inspect tool so it truly cannot mutate workspace files
4. keep mutate mode narrow and workspace-scoped
5. update examples to use the right shell tool for the scenario
6. add a small experiment set that actually requires mutation + verification

## Success Criteria

The v1 contract is good enough if:

- the agent can clearly distinguish when it is inspecting vs mutating
- traces show that distinction clearly
- library authors can explain the shell boundary in one short paragraph
- Heddle can run richer scenarios than repository summarization without pretending to have a full sandbox
