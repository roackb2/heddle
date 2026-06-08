# Agent Skills

`src/core/skills` owns Heddle's compatibility boundary for the standard Agent
Skills ecosystem.

## Responsibilities

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

## Boundaries

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

Settings-page management is intentionally left to the web surface.

## How Skills Work

A skill is a directory with a `SKILL.md` file:

```text
.agents/skills/browser-research/SKILL.md
~/.agents/skills/browser-research/SKILL.md
```

`AgentSkillService.loadCatalog()` discovers project, user, and built-in skill
roots, reads only `SKILL.md` frontmatter, validates supported fields, and
returns a catalog. It does not expose the markdown body during catalog load.

Supported frontmatter fields are:

- `name`
- `description`
- `license`
- `compatibility`
- `allowed-tools`
- `metadata`

Project skills have precedence over user skills with the same name. Duplicate
lower-precedence skills are reported as catalog issues instead of replacing the
first entry.

## Activation Model

Discovery is not activation. A discovered skill is only available to the agent
after the workspace activates it.

Activation state is stored in:

```text
<stateRoot>/skills/activation.json
```

For normal CLI use, `stateRoot` is the workspace `.heddle` directory:

```text
.heddle/skills/activation.json
```

The activation store records only consent/status metadata:

- skill name
- source (`project`, `user`, or `built-in`)
- original `SKILL.md` path
- status (`active` or `disabled`)
- activation/update timestamps

It never copies the full `SKILL.md` body, scripts, assets, or references into
Heddle state.

Service-level activation uses:

- `AgentSkillService.activateSkill(name)`
- `AgentSkillService.disableSkill(name)`
- `AgentSkillService.listActivationViews()`
- `AgentSkillService.loadActivatedCatalog()`

`loadActivatedCatalog()` filters the discovered catalog to active skills only.
That filtered catalog is the only skill catalog the runtime can expose to the
model.

## How Users Activate Or Disable Skills

Terminal users manage workspace activation through core slash commands:

```text
/skills
/skills enable browser-research
/skills disable browser-research
```

`/skills` lists activation views in sections:

- `Active`: enabled for future turns in this workspace
- `Available`: discovered but not enabled
- `Disabled`: previously enabled and then disabled
- `Missing definitions`: activation records whose original `SKILL.md` is gone

The web settings page does not manage Agent Skills yet. Until that exists, the
TUI slash commands are the user-facing activation path.

## What The Agent Sees Before Loading A Skill

`AgentSkillsRuntimeContextService.appendActivatedCatalog()` appends a compact
catalog only when the default tool bundle includes `read_agent_skill` and at
least one skill is active.

The model sees metadata like this:

```xml
Agent Skills are available through progressive disclosure. Use read_agent_skill with a skill name when a skill is relevant; do not assume full skill instructions are already in context.
<available_skills>
<skill>
<name>browser-research</name>
<description>Use browser tools to inspect pages, gather evidence, and summarize findings.</description>
<location>/path/to/.agents/skills/browser-research/SKILL.md</location>
</skill>
</available_skills>
```

The catalog intentionally omits the full `SKILL.md` body. The model should use
the name and description to decide whether a skill is relevant, then call
`read_agent_skill` for one active skill when needed.

Inactive, disabled, missing, invalid, and duplicate-lower-precedence skills are
not included in the runtime catalog.

## What The Agent Receives After Loading A Skill

The `read_agent_skill` tool reads active skills only. A normal skill read is:

```json
{
  "name": "browser-research"
}
```

The tool returns the active skill's full markdown body and resource hints:

```json
{
  "name": "browser-research",
  "source": "project",
  "body": "# Browser Research\n\nUse browser snapshots before making claims.",
  "resources": [
    {
      "name": "browser checklist",
      "path": "references/browser-checklist.md"
    }
  ]
}
```

If the skill body links to a resource under `scripts/`, `references/`, or
`assets/`, the model can request that linked resource by name or path:

```json
{
  "name": "browser-research",
  "resource": "references/browser-checklist.md"
}
```

Resources are resolved relative to the skill root and must remain inside that
root. External links, absolute paths, parent-directory escapes, and unlinked
files are not readable through this domain.

## Safety Contract

Skills are instructions, not permissions. Enabling a skill changes what
instructions the model can discover and read; it does not grant new runtime
capabilities.

Heddle's runtime approval policy, shell/file safety checks, browser policy, and
workspace permissions remain authoritative. If a skill asks the model to run a
command, edit a file, use browser automation, or perform an account-affecting
action, that action still goes through the normal tool and approval path.
