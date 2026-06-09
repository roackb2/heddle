# Agent Skills

Heddle supports the standard Agent Skills folder format so you can teach the
agent reusable workflows without pasting long instructions into every prompt.

Skills are discovered from:

- project skills under `.agents/skills/<name>/SKILL.md`
- user skills under `~/.agents/skills/<name>/SKILL.md`
- Heddle built-in skills shipped with the package

Project skills take precedence over user skills with the same name. Heddle only
stores workspace activation state under `.heddle/skills/activation.json`; it
does not copy skill definitions into Heddle state.

Built-in skills are Heddle-owned instructions for common capabilities. They are
visible in the same catalog as project and user skills, but they are still not
active by default.

## Skill Format

Each skill is a folder containing a `SKILL.md` file with YAML frontmatter:

```md
---
name: browser-research
description: Use browser tools to inspect pages, gather evidence, and summarize findings.
---
# Browser Research

Use browser snapshots before making claims about page content.
Avoid checkout, purchase, or account-changing flows unless the user explicitly
asks and the runtime approval policy allows the action.
```

Heddle currently accepts these frontmatter fields:

- `name`
- `description`
- `license`
- `compatibility`
- `allowed-tools`
- `metadata`

The catalog shown to the model includes only metadata such as name and
description. The full `SKILL.md` body is read later through progressive
disclosure when the model chooses a relevant active skill.

## Enable Skills In Chat

Use the terminal slash commands inside `heddle` or `heddle chat`:

```text
/skills
/skills enable browser-research
/skills disable browser-research
```

`/skills` lists skills in sections:

- `Active`: enabled for future turns in this workspace
- `Available`: discovered but not enabled
- `Disabled`: previously enabled and then disabled
- `Missing definitions`: activation records whose `SKILL.md` no longer exists

Only active skills are shown to the agent during a run.

Browser Automation also has a capability-specific shortcut:

```text
/browser
/browser enable
/browser disable
```

`/browser enable` activates Heddle's built-in `browser-automation` skill and
adds browser tools to future default agent turns in the current workspace. The
equivalent web path is Settings -> Browser Automation.

The browser skill teaches the agent when browser automation is useful: visual
inspection for frontend work, user-requested website interaction, web research,
shopping comparison, and tasks where rendered browser state matters. It also
reminds the agent that logged-in sites require a selected browser profile with a
valid session; without one, only public or non-session pages should be assumed
reachable.

If an agent needs a starting URL, it may use `web_search` to discover the
target page, but it should switch to `browser_open` and `browser_snapshot` when
the user asked for browser interaction or rendered page evidence.

## What The Agent Sees

When active skills exist, Heddle appends a compact catalog to the system context:

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

The model can then call `read_agent_skill` to read the full instructions for
one active skill. If the skill body links to resources under `scripts/`,
`references/`, or `assets/`, the model can request those linked resources with
the same tool.

## Safety Model

Skills are instructions, not permissions. Enabling a skill makes its catalog
entry available to the agent and lets the agent read its full instructions when
needed. It does not bypass Heddle's tool approval policy, shell/file safety
checks, browser policy, or workspace permissions.

You are responsible for the skills you place under `.agents/skills` or
`~/.agents/skills`. Read skills before enabling them, especially if they ask the
agent to use shell commands, browser automation, account flows, or external
services.

## See Also

- [Chat and sessions](chat-and-sessions.md)
- [Capabilities and tools](../reference/capabilities.md)
- [CLI reference](../reference/cli.md)
