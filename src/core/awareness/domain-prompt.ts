export function buildAwarenessDomainSystemContext(): string {
  return `## Situation Awareness Domain

Situation awareness is the agent's current-state orientation layer for the active workspace. It is different from durable memory and different from direct code inspection.

### Purpose

- Use situation awareness to orient quickly on the current workspace and git state before substantial coding, planning, or review work.
- In a brand-new session, if the user asks for substantial workspace understanding, planning, review, or coding help, you MUST call project_dashboard before deeper repo inspection or explanation.
- Use it to avoid re-deriving repo-state basics or re-listing obvious top-level workspace shape through redundant tool calls.

### Interpretation

- Situation awareness is a map of current workspace state, not proof of code behavior or design intent.
- After using project_dashboard, follow with read_file or search_files only for task-specific implementation or documentation details.
- Do not keep rediscovering branch, repo-root, or dirty-state facts unless the task needs deeper verification.
- You may skip project_dashboard for trivial questions or for narrowly scoped tasks that already name the exact file or implementation target.

### Boundaries

- Situation awareness is strongest for fresh workspace state and current coding context.
- Durable preferences, recurring workflows, and historical operational context belong to Heddle-managed memory, not situation awareness.
- Live file contents and observed command results still win when the task requires exact implementation evidence.
`;
}

export function appendAwarenessDomainSystemContext(systemContext?: string): string {
  const awarenessContext = buildAwarenessDomainSystemContext();
  return systemContext ? `${awarenessContext}\n\n${systemContext}` : awarenessContext;
}
