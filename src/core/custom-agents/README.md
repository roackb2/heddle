# Custom Agents

`src/core/custom-agents` owns custom-agent definitions and their conversion into
turn execution snapshots. A custom agent is a named runtime profile: prompt
appendix, tool profile, approval profile, and optional runtime defaults.

This domain does not run agents, mutate chat sessions, decide UI state, or own
workflow triggers. Chat/control-plane callers resolve a selected `agentProfileId`
at prompt acceptance time and persist the resulting `CustomAgentExecutionSnapshot`
with that accepted turn. Runtime code then applies the snapshot while building
the concrete prompt, tools, and approval policies for that turn.

Definition sources:

- built-ins from `built-ins.ts` (`builtin:code`, `builtin:ask`, `builtin:review`);
- project definitions in `<workspaceRoot>/.agents/agents/<id>/AGENT.md`;
- user definitions in `~/.agents/agents/<id>/AGENT.md`.

Project definitions override user definitions with the same id. Built-in ids are
reserved and cannot be shadowed by file definitions.

Keep permission enforcement out of this folder. Tool filtering belongs in
`src/core/runtime/tools`, and approval-policy compilation belongs in
`src/core/approvals`.
