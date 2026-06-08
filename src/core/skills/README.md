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
- read referenced `scripts/`, `references/`, and `assets/` resources only
  after the skill body has linked to them;
- persist workspace-level activation status under Heddle state without copying
  skill definitions.

Boundaries:

- This domain does not grant tool permissions. `allowed-tools` is preserved as
  skill metadata, while Heddle's runtime approval policy remains authoritative.
- This domain does not store skill definitions in Heddle state. Activation
  state stores only the skill name, source, path, status, and timestamps.
- Tool exposure belongs in `src/core/tools`; `read_agent_skill` reads only
  activated skills and linked resources.
- Runtime bundle assembly belongs in `src/core/runtime/tools`; active catalog
  prompt injection belongs in `AgentSkillsRuntimeContextService`.
- TUI activation is exposed through core slash commands (`/skills`,
  `/skills enable <name>`, `/skills disable <name>`) consumed by the existing
  control-plane slash command path.

The live runtime appends an `<available_skills>` block for workspace-approved
skills only. The model can then call `read_agent_skill` to fetch the full
definition or a linked resource. Settings-page management is intentionally left
to the web surface.
