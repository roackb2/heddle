# Agent Skills

`src/core/skills` owns Heddle's compatibility boundary for the standard Agent
Skills ecosystem.

Responsibilities:

- discover skill folders from project `.agents/skills`, user
  `~/.agents/skills`, and package-provided built-in skill roots;
- parse and validate `SKILL.md` frontmatter with Heddle-owned semantics backed
  by the mature `yaml` parser;
- expose only catalog metadata for initial agent context;
- read the full skill body only when a caller explicitly asks for one skill;
- persist workspace-level activation status under Heddle state without copying
  skill definitions.

Boundaries:

- This domain does not grant tool permissions. `allowed-tools` is preserved as
  skill metadata, while Heddle's runtime approval policy remains authoritative.
- This domain does not store skill definitions in Heddle state. Activation
  state stores only the skill name, source, path, status, and timestamps.
- Tool exposure belongs in `src/core/tools`; runtime bundle assembly belongs in
  `src/core/runtime/tools`.

The first live-runtime integration point should use
`AgentSkillService.loadActivatedCatalog()` to add an `<available_skills>` block
for workspace-approved skills only, then use a consent-gated tool to call
`AgentSkillService.readSkill(name)` when the model requests a full definition.
