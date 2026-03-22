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
A current boundary sketch for those layers lives in [docs/awareness-and-memory.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/awareness-and-memory.md).

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

## Next Step

The immediate next step is to run `examples/repo-investigator.ts` against this repo, save the trace, and review concrete failure modes before adding new abstractions. A review template lives in [docs/first-run-review.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/first-run-review.md).
An eval batch prompt set lives in [docs/eval-prompts.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/eval-prompts.md), with a batch review template in [docs/eval-review.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/eval-review.md).

The example runner defaults to `gpt-5.1-codex-mini`. Override it with `OPENAI_MODEL` if you want to compare models.

## Design Principles

1. **Don't over-abstract early** — no concept becomes a first-class abstraction until a recurring failure mode justifies it
2. **Trace is a first-class citizen** — every step is recorded; the trace is the primary diagnostic artifact
3. **Runtime supports the agent, doesn't govern it** — the agent decides; the runtime executes and records
4. **Abstractions must have a root cause** — every module must answer: what recurring problem does this solve?

## Roadmap Shape

Near term, Heddle is intentionally focused on a single, minimal execution loop plus traceability.

Longer term, the expectation is that different domains can plug into the same core loop through domain adapters and toolkits. Code/file operations are only one application of the runtime, not the definition of the runtime itself.

## License

MIT
