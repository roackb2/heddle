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

- `src/core/agent/tools/tool-dispatcher.ts`
- `src/core/approvals/service.ts`
- `src/core/approvals/policies.ts`
- `src/core/approvals/pending-approval.ts`
- `src/core/approvals/remembered-rules/`
- `src/cli/chat/hooks/controllers/run/tui-tool-approval.ts`
- `src/server/features/control-plane/controllers/chat-sessions-controller.ts`
- `src/server/features/control-plane/controllers/chat-session-events.ts`

## Public Entry Points

- `types.ts`: approval request, decision, policy, and surface types.
- `service.ts`: `ToolApprovalService` ordered policy evaluation and request-to-human
  approval resolution.
- `policies.ts`: `ToolApprovalPolicies` built-in tool, workspace-boundary,
  remembered-rule, and human-surface policy constructors.
- `pending-approval.ts`: `PendingToolApprovalRequests` host-neutral pending
  approval promise/view primitive.
- `remembered-rules/`: project approval rule service, repository, codec,
  schemas, and types.

## Extension Points

- Add a runtime approval rule by passing `approvalPolicies` into `AgentRunService.run`,
  `runAgentLoop`, `runAgentHeartbeat`, or `createConversationEngine(...).turns`.
- Add host UI by implementing an approval surface in the host adapter layer.
- Add remembered approval storage through `FileProjectApprovalRuleRepository` or
  a focused repository with the same service/codec boundary.

## Common Changes

- To add a policy, write table-driven tests that cover policy order and abstain
  behavior.
- Remembered approval rule semantics live in `ProjectApprovalRules`; file IO
  lives in `FileProjectApprovalRuleRepository`; persisted JSON validation lives
  in `ProjectApprovalRuleCodec` and Zod schemas.
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
- Meaningful behavior belongs on the owning approval class. Do not add thin
  wrapper functions for old import paths.
