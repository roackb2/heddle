# Agent

The agent domain owns the low-level model/tool step loop. It is the inner
execution engine used by runtime, chat turns, memory maintenance, and examples.

## Owns

- Building the initial model transcript for one run.
- Calling the LLM adapter step by step.
- Streaming assistant content to host callbacks.
- Executing model-requested tools through a registry.
- Recording low-level `TraceEvent` evidence.
- Emitting user-facing `ConversationActivity` for inner-loop moments that
  interfaces should render live.
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

- `service.ts`: `AgentRunService`, the class-owned low-level run loop.
- `types.ts`: public run-loop contract and mutable run context shape.

## Internal Structure

- `context/`: builds the mutable run context and initial model transcript.
- `budget/`: tracks max-step consumption for one run.
- `model/`: owns one LLM request, stream presentation, and usage accumulation.
- `tools/`: owns assistant tool-call turns, dispatch, approval, fallback, and
  repeat tracking.
- `finish/`: owns final response, interruption, error, and max-step completion.
- `history/`: sanitizes reused transcripts before model calls.
- `mutation/`: classifies workspace-changing tool results.
- `memory/`: tracks in-run memory-checkpoint requirements.
- `planning/`: parses `update_plan` tool output into run state.
- `utils/`: low-level serialization, abort, and tool-input helpers only.

## Extension Points

- Add per-step behavior by explicit callbacks or future turn/runtime middleware,
  not by importing host state.
- Add tool execution behavior through `ToolDefinition` and the tool registry.
- Add trace detail by emitting typed `TraceEvent` values and updating the
  observability summarizer/projection path. If the same moment is also
  user-facing, use the live recorder helper to emit trace and activity together
  with the same canonical event name.

## Common Changes

- To add a new trace event from the inner loop, update `TraceEvent`, record it in
  the owning service class, and add tests for trace ordering. If it should be
  shown live to users, update `ConversationActivity` too and emit both from the
  origin instead of adding a trace-to-activity mapper.
- To change tool fallback behavior, keep fallback rules pure and covered by
  integration tests in `run-agent.test.ts`.
- To change approval behavior, prefer the approval domain. The agent loop should
  ask for decisions, not own policy storage or UI.

## Tests

- `src/__tests__/integration/core/run-agent.test.ts`
- `src/__tests__/unit/core/trace-format.test.ts`

## Notes For Coding Agents

- This is the inner loop. Keep it small, deterministic, and host-agnostic.
- Follow the chat-engine reference pattern here too: meaningful behavior belongs
  inside an owning class, contracts live in nearby `types.ts`, and file/class
  comments should briefly explain responsibility.
- Avoid adding root-level one-off exported domain functions. If behavior belongs
  to this domain, put it on the owning class. If it is low-level and
  domain-agnostic, keep it under `utils/`.
- Do not add session, TUI, web, or server concepts here.
