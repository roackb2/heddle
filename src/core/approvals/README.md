# Approvals

The approvals domain is the planned home for approval policy, remembered
approval rules, approval requests, and host approval surfaces.

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

Approval behavior is currently spread across:

- `src/core/agent/tool-dispatch.ts`
- `src/core/chat/tool-approval-host.ts`
- `src/core/approvals/remembered-rules.ts`
- `src/cli/chat/hooks/tui-tool-approval.ts`
- `src/server/features/control-plane/services/chat-sessions.ts`
- `src/server/features/control-plane/services/chat-session-events.ts`

Future milestones should move stable policy behavior here while leaving host UI
adapters in their host folders.

## Planned Public Entry Points

- `types.ts`: approval request, decision, policy, and surface types.
- `policy-chain.ts`: ordered first-decision policy evaluation.
- `default-policies.ts`: built-in safety, tool, and workspace-boundary policies.
- `remembered-rules.ts`: project/user approval rule persistence and matching.
- `surface.ts`: host human-approval surface interface.

## Extension Points

- Add a new approval rule as an `ApprovalPolicy`.
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
- `src/__tests__/integration/core/run-agent.test.ts`
- `src/__tests__/integration/tools/tools.test.ts`
- Future approval policy-chain tests under `src/__tests__/unit/core`.

## Notes For Coding Agents

- Approval policy belongs here; approval presentation belongs in hosts.
- Use ordered policy arrays instead of nested branching.
- Core approval code must not import from TUI, web, or server modules.
