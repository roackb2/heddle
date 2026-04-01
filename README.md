# Heddle

A TypeScript runtime for building general tool-using agents, starting from a minimal executable loop.

## What It Is

Heddle's long-term goal is to grow into a credible general agent framework: something that can support different domains through adapters, tools, traces, and runtime support without baking in a premature cognitive architecture.

Heddle does not start there. It starts as a small, executable loop that lets an LLM use tools against a real environment, records every step as a trace, and stops when the agent finishes, hits a budget limit, or encounters an unrecoverable error.

The design philosophy is **behavior-first**: get a working loop running, observe what the agent actually struggles with, and only then harden recurring failure modes into deterministic runtime support.

So the project stance is:

- ultimate direction: a general agent framework/runtime
- current implementation: a minimal execution loop
- growth model: add abstractions only after real traces justify them

Longer-term framework direction is documented in [docs/framework-vision.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/framework-vision.md), including future concepts like situation awareness and knowledge persistence.

The project-level statement of why Heddle exists and how it decides what to build versus borrow lives in [docs/project-purpose.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/project-purpose.md).

The phased roadmap for turning Heddle into a conversational coding agent that can eventually help build itself lives in [docs/coding-agent-roadmap.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/coding-agent-roadmap.md).

## What It Is Not

- A prompt orchestration library
- A multi-agent framework
- A pre-defined cognitive architecture with phases, plans, and world-state ontologies
- Another LangChain wrapper

## Core Loop

```
goal
  -> prompt model with available tools + prior transcript
  -> model either answers or requests a tool call
  -> execute tool
  -> append result to transcript
  -> continue
  -> stop on done / max steps / unrecoverable error
```

## Status

Early development. v0 in progress.

The repo now has:

- `yarn chat`
- `yarn chat:dev`

as an early conversational terminal entrypoint from Phase 0 of the coding-agent roadmap.

Phase 1 has also started at the tool-contract layer:

- shell capability is now split into `run_shell_inspect` and `run_shell_mutate`
- inspect vs mutate intent is explicit in tool names, descriptions, and traces
- examples expose both shell modes to the agent runtime
- chat mode now pauses for human approval before `run_shell_mutate` executes
- shell execution is now governed by explicit workspace/inspect policy rules with scope and risk metadata, rather than only a flat command-prefix list
- workspace-changing mutate commands now trigger host-side follow-up requirements before final answer: review repo state and run verification
- after workspace-changing mutate runs, the host now also requires a short operator-style final summary with `Changed:`, `Verified:`, and `Remaining uncertainty:`
- chat mode now supports real interrupt via `Esc` and resume via `/continue`

## Next Step

The immediate next step is to keep tightening the Phase 1 coding-agent surface around git-native review and explanation: better use of concrete diff/status evidence, stronger operator confidence after bounded edits, and continued evolution toward policy-based execution instead of narrow command-prefix allowlists.
An eval batch prompt set lives in [docs/eval-prompts.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/eval-prompts.md).

The shell direction is also intentionally moving toward a policy-based execution surface rather than an ever-growing allowlist of specific commands.

The example runner defaults to `gpt-5.1-codex-mini` and a 40-step budget. Override them with `OPENAI_MODEL` and `HEDDLE_MAX_STEPS` if you want to compare models or cap exploration more tightly.

## Design Principles

1. **Don't over-abstract early** — no concept becomes a first-class abstraction until a recurring failure mode justifies it
2. **Trace is a first-class citizen** — every step is recorded; the trace is the primary diagnostic artifact
3. **Runtime supports the agent, doesn't govern it** — the agent decides; the runtime executes and records
4. **Abstractions must have a root cause** — every module must answer: what recurring problem does this solve?
5. **Tools need clear mental models** — agent-facing tools should behave like stable instruments, with predictable semantics and explicit heuristic vs deterministic boundaries
6. **Prefer safe environments over endless wrappers** — keep a few high-frequency structured tools, but rely on bounded shell or other environment adapters for the long tail of real-world capabilities

## Roadmap Shape

Near term, Heddle is intentionally focused on a single, minimal execution loop plus traceability.

Longer term, the expectation is that different domains can plug into the same core loop through domain adapters and toolkits. Code/file operations are only one application of the runtime, not the definition of the runtime itself.

## License

MIT
