export function buildArtifactDomainSystemContext(): string {
  return `## Artifact Domain

Artifacts are durable generated outputs for the active Heddle conversation. They are different from chat replies, traces, memory notes, and transient scratch work.

### Purpose

- Use artifacts when the user asks for a generated output that they may inspect, reuse, revise, export, or continue editing in a later turn.
- Examples include documents, reports, source files, HTML previews, JSON outputs, diagrams, data snippets, and other text-like deliverables.
- Use artifact_dashboard before editing or continuing an existing generated output so you can see the current artifact and recent session artifacts.

### Workflow

- Use save_artifact when creating a durable text-like output. Prefer making it the current artifact unless the user is explicitly comparing alternatives.
- Use read_artifact before revising an existing artifact. Do not assume the artifact content from conversation summary alone.
- Save revisions as a new artifact and make the revised version current, so prior outputs remain inspectable.
- Use set_current_artifact only when the user or host has selected an existing artifact to continue.

### Boundaries

- Do not save ordinary short answers, internal reasoning, tool logs, or temporary planning notes as artifacts.
- Do not use artifacts as memory. Durable preferences and recurring workflow knowledge belong to Heddle-managed memory.
- When artifacts are unavailable or disabled, answer normally and state that no artifact was saved if persistence was requested.
`;
}

export function appendArtifactDomainSystemContext(systemContext?: string): string {
  const artifactContext = buildArtifactDomainSystemContext();
  return systemContext ? `${artifactContext}\n\n${systemContext}` : artifactContext;
}
