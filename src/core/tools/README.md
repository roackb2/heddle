# Tools

The tools domain owns Heddle's executable capabilities: structured functions the
agent can call to inspect, modify, search, remember, and reason about a
workspace.

## Owns

- `ToolDefinition` implementations for current built-in tools.
- Tool registry creation and duplicate-name protection.
- Tool execution wrapper and timeout behavior.
- Workspace file tools.
- Shell inspect/mutate tools and their current command policy rules.
- Memory note and memory checkpoint tools.
- Web search and image inspection tools.
- Planning tool support through `update_plan`.

## Does Not Own

- Model/tool step orchestration. That lives in `src/core/agent`.
- Default runtime bundle policy. That currently lives in `src/core/runtime`.
- Human approval policy and remembered approvals. Those should live in
  `src/core/approvals`.
- Host UI for tool calls or results.
- Memory maintenance domain rules beyond tool interfaces.

## Public Entry Points

- `registry.ts`: create a tool registry.
- `execute-tool.ts`: execute one tool call against a registry.
- `run-shell.ts`: shell inspect/mutate tools and command classification.
- `read-file.ts`, `list-files.ts`, `search-files.ts`, `edit-file.ts`,
  `delete-file.ts`, `move-file.ts`: workspace file tools.
- `memory-notes.ts`, `record-knowledge.ts`, `memory-checkpoint.ts`: memory tools.
- `web-search.ts`, `view-image.ts`: external/rich context tools.
- `update-plan.ts`: structured plan tool.

## Extension Points

- Add new tools as small `createXTool(options)` factories returning
  `ToolDefinition`.
- Keep tool input validation close to the tool.
- Group tools into toolkits when the tool-domain refactor starts; preserve
  `createDefaultAgentTools` behavior while doing so.
- Attach approval policy through approval/toolkit registration rather than
  embedding host approval UI in tool implementations.

## Common Changes

- To add a workspace tool, add a tool factory, unit/integration tests, and wire
  it through the default tool bundle only when it is part of Heddle's standard
  situation-awareness surface.
- To change shell command policy, update classification tests and approval-rule
  compatibility tests.
- To change a tool output shape, update trace/review projection tests if hosts
  depend on that output.

## Tests

- `src/__tests__/integration/tools/tools.test.ts`
- `src/__tests__/unit/tools/run-shell.command.test.ts`
- `src/__tests__/unit/tools/core-utils.test.ts`
- `src/__tests__/integration/core/run-agent.test.ts`

## Notes For Coding Agents

- Tools should be deterministic wrappers over capability, not orchestration
  hubs.
- Do not add UI text or React/Ink/server imports here.
- Prefer pure helper maps and table-driven policy definitions over long
  branching logic.

