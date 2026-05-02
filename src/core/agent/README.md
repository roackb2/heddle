# Agent

The agent domain owns the low-level model/tool step loop. It is the inner
execution engine used by runtime, chat turns, memory maintenance, and examples.

## Owns

- Building the initial model transcript for one run.
- Calling the LLM adapter step by step.
- Streaming assistant content to host callbacks.
- Executing model-requested tools through a registry.
- Recording low-level `TraceEvent` evidence.
- Applying tool approval callbacks supplied by outer domains.
- Tracking mutation and memory-checkpoint signals inside a run.
- Stopping on completion, max steps, error, or host interruption.

## Does Not Own

- Session storage, turn persistence, compaction, leases, or chat history files.
- Provider credential discovery and default tool assembly.
- UI or host-specific approval surfaces.
- Durable memory maintenance after a turn finishes.
- Slash commands or prompt classification.

## Public Entry Points

- `run-agent.ts`: low-level run loop and `RunAgentOptions`.
- `tool-dispatch.ts`: approval, execution, fallback, and repeat tracking around
  tool calls.
- `history.ts`: transcript sanitation helpers.
- `mutation-tracking.ts`: mutation classification used by run state.
- `progress-reminders.ts` and `post-mutation.ts`: currently conservative
  scaffolds for future follow-up behavior.

## Extension Points

- Add per-step behavior by explicit callbacks or future turn/runtime middleware,
  not by importing host state.
- Add tool execution behavior through `ToolDefinition` and the tool registry.
- Add trace detail by emitting typed `TraceEvent` values and updating the
  observability summarizer/projection path.

## Common Changes

- To add a new trace event from the inner loop, update `TraceEvent`, record it in
  `run-agent.ts` or `tool-dispatch.ts`, and add tests for trace ordering.
- To change tool fallback behavior, keep fallback rules pure and covered by
  integration tests in `run-agent.test.ts`.
- To change approval behavior, prefer the approval domain. The agent loop should
  ask for decisions, not own policy storage or UI.

## Tests

- `src/__tests__/integration/core/run-agent.test.ts`
- `src/__tests__/unit/core/trace-format.test.ts`
- `src/__tests__/integration/core/progress.test.ts`

## Notes For Coding Agents

- This is the inner loop. Keep it small, deterministic, and host-agnostic.
- Prefer handler maps and small helpers over long nested conditionals.
- Do not add session, TUI, web, or server concepts here.

