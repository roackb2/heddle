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

Early development. v0 in progress. Phase 1 now has a first-class edit_file tool.

## Install And Run

Heddle can now be linked or installed as a CLI and run against the current working directory instead of only this repo.

Local development:

- `yarn install`
- `npm link`
- from any project directory: `heddle`

One-shot usage:

- `heddle ask "What does this project do?"`
- `heddle ask "What does this project do?" --cwd /path/to/project`

Chat usage:

- `heddle`
- `heddle chat`
- `heddle --cwd /path/to/project`
- `heddle chat --model gpt-5.1-codex-mini --max-steps 20`

The chat and ask commands both use the directory you launch them from as the workspace root. Traces, logs, and saved chat sessions are written under `./.heddle/` in that project by default.

Per-project defaults:

- create `heddle.config.json` in the target project root

```json
{
  "model": "gpt-5.1-codex",
  "maxSteps": 40,
  "stateDir": ".heddle",
  "directShellApproval": "never",
  "searchIgnoreDirs": [".git", "dist", "node_modules", ".heddle"],
  "agentContextPaths": ["AGENTS.md"]
}
```

CLI flags override `heddle.config.json`, and `heddle.config.json` overrides environment defaults.

Notes:

- `stateDir` controls where traces, logs, and saved chat sessions are stored relative to the project root.
- `directShellApproval` controls whether explicit user `!command` input in chat is auto-approved (`"never"`) or still goes through the approval UI (`"always"`).
- `searchIgnoreDirs` controls which directories `search_files` skips for that project.
- `agentContextPaths` controls which project instruction files are injected into Heddle's system prompt. By default, Heddle looks for `AGENTS.md`.

The repo now has:

- `yarn chat`
- `yarn chat:light`
- `yarn chat:dev`
- `yarn chat:dev:light`
- `heddle`
- `heddle ask "<goal>"`

as an early conversational terminal entrypoint from Phase 0 of the coding-agent roadmap.

Phase 1 has also started at the tool-contract layer:

- shell capability is now split into `run_shell_inspect` and `run_shell_mutate`
- file editing now has a first-class `edit_file` tool instead of depending only on shell-based file-writing workarounds
- inspect vs mutate intent is explicit in tool names, descriptions, and traces
- examples expose both shell modes to the agent runtime
- chat mode now pauses for human approval before `run_shell_mutate` executes
- shell execution is now governed by explicit workspace/inspect policy rules with scope and risk metadata, rather than only a flat command-prefix list
- known inspect commands remain narrowly classified, while unclassified mutate commands now fall back to explicit approval instead of hard rejection
- workspace-changing mutate commands now trigger host-side follow-up requirements before final answer: review repo state and run verification
- after workspace-changing mutate runs, the host now also requires a short operator-style final summary with `Changed:`, `Verified:`, and `Remaining uncertainty:`
- chat mode now supports real interrupt via `Esc` for agent turns and direct `!command` runs, plus resume via `/continue`
- chat mode now persists local sessions and supports `/session list`, `/session switch <id>`, and `/session continue <id>`
- chat mode now auto-titles generic sessions in the background with `gpt-5.1-codex-mini`
- chat mode now supports direct shell commands with a `!command` prefix; user-entered direct commands run immediately under the same shell policy, and their results are stored in the session transcript for later turns
- interrupted or incomplete tool-call history is now sanitized before the next run so saved sessions do not poison later turns with missing tool outputs
- `Recent Turns` is a completed-turn summary, not a live run panel; while a run is in progress it may still show the previous turn until the current one finishes

Chat usage notes:

- use `/continue` for built-in resume behavior; plain `continue` is treated as a normal user prompt
- if a long-running turn appears stuck, `Esc` requests an interrupt for the current run
- current shell policy is still conservative about heredocs, redirects, and similar shell syntax; the longer-term direction is to rely less on naive shell-character blocking and more on approval, scope, and audit policy

## Next Step

The immediate next step is to keep tightening the Phase 1 coding-agent surface around git-native review and explanation: better use of concrete diff/status evidence, stronger operator confidence after bounded edits, and continued evolution toward policy-based execution instead of narrow command-prefix allowlists.
An eval batch prompt set lives in [docs/eval-prompts.md](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/eval-prompts.md).

The shell direction is also intentionally moving toward a policy-based execution surface rather than an ever-growing allowlist of specific commands.

One current limitation is worth calling out explicitly: Heddle can now recover from interrupted tool-call history correctly, but it still sometimes stops after discovering a safe execution path instead of carrying a requested change through to completion. Closing that follow-through gap is part of making the agent genuinely useful.

The example runner and chat mode now default to `gpt-5.1-codex` and a 40-step budget. Use `yarn chat:light` or `yarn chat:dev:light` for `gpt-5.1-codex-mini`, or override manually with `OPENAI_MODEL` and `HEDDLE_MAX_STEPS` if you want to compare models or cap exploration more tightly.

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
