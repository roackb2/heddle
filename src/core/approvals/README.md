# Approvals

The approvals domain owns approval policy, remembered approval rules, approval
requests, and host approval surfaces.

## Owns

- Approval request and decision types.
- Ordered approval policy chains.
- Remembered project/user approval rules.
- Host approval surface interfaces.
- Approval-related trace/event helpers.

## Does Not Own

- Tool execution itself.
- TUI modals, Ink pending approval state, or browser pending approval UI.
- Shell command execution.
- Session persistence.

## Current Source Locations

Approval behavior currently exists in these places:

- `src/core/agent/tool-dispatch.ts`
- `src/core/approvals/surface.ts`
- `src/core/approvals/remembered-rules.ts`
- `src/cli/chat/hooks/tui-tool-approval.ts`
- `src/server/features/control-plane/services/chat-sessions.ts`
- `src/server/features/control-plane/services/chat-session-events.ts`

## Public Entry Points

- `types.ts`: approval request, decision, policy, and surface types.
- `policy-chain.ts`: ordered policy evaluation and request-to-human approval
  resolution.
- `default-policies.ts`: built-in tool, workspace-boundary, and remembered-rule policies.
- `remembered-rules.ts`: project/user approval rule persistence and matching.
- `surface.ts`: host human-approval surface interface.

## Extension Points

- Add a runtime approval rule by passing `approvalPolicies` into `runAgent`,
  `runAgentLoop`, `runAgentHeartbeat`, `submitChatSessionPrompt`, or
  `executeOrdinaryChatTurn`.
- Add host UI by implementing an approval surface in the host adapter layer.
- Add remembered approval storage behind a small store interface.

## Common Changes

- To add a policy, write table-driven tests that cover policy order and abstain
  behavior.
- Remembered approvals live in `remembered-rules.ts`; the old TUI state path is
  a compatibility re-export while host imports are migrated.
- To change approval trace behavior, update trace/event tests and host projection
  tests.

## Tests

- `src/__tests__/unit/core/project-approval-rules.test.ts`
- `src/__tests__/unit/core/approval-policy-chain.test.ts`
- `src/__tests__/integration/core/run-agent.test.ts`
- `src/__tests__/integration/tools/tools.test.ts`

## Notes For Coding Agents

- Approval policy belongs here; approval presentation belongs in hosts.
- Use ordered policy arrays instead of nested branching.
- Core approval code must not import from TUI, web, or server modules.
