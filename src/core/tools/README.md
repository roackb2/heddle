# Tools

The tools domain owns Heddle's executable capabilities: structured functions the
agent can call to inspect, modify, search, remember, and reason about a
workspace.

## Owns

- `ToolDefinition` implementations for current built-in tools.
- Toolkit composition and guardrails for duplicate toolkit ids and duplicate
  tool names.
- Tool registry creation and duplicate-name protection at execution time.
- Tool execution wrapper and timeout behavior.
- Coding file tools under `toolkits/coding-files/`.
- Knowledge and memory-surface tools under `toolkits/knowledge/`.
- External context tools under `toolkits/external-context/`.
- Internal workflow/state tools under `toolkits/internal/`.
- Shell/process tools and their command policy rules under `toolkits/shell-process/`.

## Does Not Own

- Model/tool step orchestration. That lives in `src/core/agent`.
- Default runtime bundle policy. That lives in `src/core/runtime`.
- Human approval policy and remembered approvals. Those live in
  `src/core/approvals`.
- Host UI for tool calls or results.
- Memory maintenance domain rules beyond the knowledge-tool interfaces.

## Current Structure

- `toolkit.ts`: shared toolkit types plus composition guardrails.
- `toolkits/coding-files/`: file/search/edit tool implementations plus shared
  edit-core behavior.
- `toolkits/knowledge/`: memory notes, memory checkpoint, and durable knowledge
  recording tools plus the knowledge toolkit composition and memory-mode policy.
- `toolkits/external-context/`: provider-backed web search and image inspection
  tools plus their toolkit composition.
- `toolkits/internal/`: internal structured workflow tools such as
  `update_plan`.
- `toolkits/shell-process/`: shell inspect/mutate execution, command policy,
  and toolkit composition.
- `toolkits/*/toolkit.ts`: production toolkit composition entry points used by
  runtime default-tool assembly.

## Public Entry Points

- `registry.ts`: create a tool registry.
- `execute-tool.ts`: execute one tool call against a registry.
- `toolkit.ts`: toolkit composition API used by runtime default-tool assembly.
- `toolkits/coding-files/*`: coding file tools.
- `toolkits/knowledge/*`: knowledge and memory-surface tools.
- `toolkits/external-context/*`: web and image tools.
- `toolkits/internal/*`: internal workflow/state tools.
- `toolkits/shell-process/*`: shell inspect/mutate tools, shell policy, and
  toolkit entry points.

## Extension Points

- Add new tools as small `createXTool(options)` factories returning
  `ToolDefinition`.
- Group related production tools under a toolkit-owned folder when the grouping
  clarifies ownership, shared policy, or composition invariants.
- Keep tool input validation close to the tool implementation.
- Add toolkit composition only when the toolkit owns a meaningful capability
  family, policy, or composition responsibility.
- Attach approval policy through approval/toolkit registration rather than
  embedding host approval UI in tool implementations.

## Common Changes

- To add a coding workspace tool, place it under `toolkits/coding-files/` when
  it belongs to the file/search/edit surface.
- To add a knowledge or memory-surface tool, place it under
  `toolkits/knowledge/` and keep memory-mode behavior centralized in the
  knowledge toolkit.
- To add a provider-backed context tool, place it under
  `toolkits/external-context/`.
- To add an internal structured workflow tool, place it under
  `toolkits/internal/`.
- To change shell/process tool behavior, update
  `toolkits/shell-process/run-shell.ts`.
- To change shell classification or policy, update
  `toolkits/shell-process/shell-policy.ts` plus the classification and
  approval-rule compatibility tests.
- To change a tool output shape, update trace/review projection tests if hosts
  depend on that output.

## Tests

- `src/__tests__/integration/tools/tools.test.ts`
- `src/__tests__/integration/core/agent-loop.test.ts`
- `src/__tests__/integration/memory/memory-integration.test.ts`
- `src/__tests__/unit/tools/run-shell.command.test.ts`
- toolkit/default-tool guardrail tests near runtime or tools integration suites

## Notes For Coding Agents

- Production ownership should be obvious from the folder structure.
- Do not keep duplicate old/new implementation locations for the same tool
  family.
- Toolkits should own real composition, grouping, or policy, not ceremonial
  forwarding.
- Tools should be deterministic wrappers over capability, not orchestration
  hubs.
- Do not add UI text or React/Ink/server imports here.
- Prefer pure helper maps and table-driven policy definitions over long
  branching logic.
