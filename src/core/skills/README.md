# Agent Skills

`src/core/skills` owns Heddle's compatibility boundary for the standard Agent
Skills ecosystem.

Responsibilities:

- discover skill folders from project `.agents/skills`, user
  `~/.agents/skills`, and package-provided built-in skill roots;
- parse and validate `SKILL.md` frontmatter with the standard
  `agent-skills-ts-sdk` package;
- expose only catalog metadata for initial agent context;
- read the full skill body only when a caller explicitly asks for one skill.

Boundaries:

- This domain does not grant tool permissions. `allowed-tools` is preserved as
  skill metadata, while Heddle's runtime approval policy remains authoritative.
- This domain does not store skill definitions in Heddle state. Future consent
  state should store activation/disabled metadata only.
- Tool exposure belongs in `src/core/tools`; runtime bundle assembly belongs in
  `src/core/runtime/tools`.

The first integration point should use `AgentSkillService.loadCatalog()` to add
an `<available_skills>` block to the agent context, then use a consent-gated
tool to call `AgentSkillService.readSkill(name)` when the model requests a full
definition.
