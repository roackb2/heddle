# Custom Agents

Custom agents let you choose the role Heddle should use for a specific turn.
They are named runtime profiles made from four pieces:

- a prompt appendix that is appended to Heddle's default system prompt;
- a tool profile that decides which tools the model can see;
- an approval profile that decides how sensitive actions are handled;
- optional runtime defaults such as `maxSteps`, `model`, or `reasoningEffort`.

Custom agents do not replace Heddle's default safety model. Tool selection still
goes through Heddle runtime tool profiles, and approval enforcement still goes
through Heddle approval policy.

## Built-In Modes

Heddle ships three built-in custom agents:

- `builtin:ask`: read-only workspace inspection for questions and explanation;
- `builtin:code`: the default coding agent with normal Heddle tools and
  interactive approval behavior;
- `builtin:review`: read-only code and diff review without applying fixes.

In the browser composer these appear as quick modes: Ask, Code, and Review.
They are implemented as custom agents, but the user-facing model is simply
"choose the right mode for this prompt."

Agent selection is turn-scoped. You can ask a question with Ask, switch to Code
for implementation, then switch to Review in the same saved session. Selecting
an agent does not permanently bind the whole session to that profile.

## Where Agent Definitions Live

Project agents live in the workspace:

```text
.agents/agents/<agent-id>/AGENT.md
```

User agents live in your home directory:

```text
~/.agents/agents/<agent-id>/AGENT.md
```

Project agents override user agents with the same id. Built-in ids such as
`builtin:ask`, `builtin:code`, and `builtin:review` are reserved and cannot be
shadowed by files.

## Example Agent

Create `.agents/agents/repo-reviewer/AGENT.md`:

```md
---
schemaVersion: 1
id: repo-reviewer
name: Repo Reviewer
description: Review repository changes without applying fixes.
modeAlias: review
runtime:
  maxSteps: 80
tools:
  preset: inspect
approval:
  preset: read_only
---

You are a repository review agent.

Prioritize correctness, reliability, missing tests, and maintainability.
Lead with actionable findings grounded in file paths, diffs, command output, or
trace evidence. Do not edit files or run mutation commands.
```

The YAML frontmatter configures the profile. The markdown body is the prompt
appendix that Heddle adds after its normal system instructions.

## Common Fields

Required fields:

- `schemaVersion: 1`
- `id`: stable id used by the UI and CLI
- `name`: user-facing name
- `description`: short catalog description

Optional fields:

- `modeAlias`: `ask`, `code`, or `review`, used as a hint for how the agent
  should be grouped or presented.
- `runtime.maxSteps`: turn step budget for this agent.
- `runtime.model`: default model for this agent.
- `runtime.reasoningEffort`: `low`, `medium`, `high`, or `ultrahigh`.
- `tools.preset`: `default`, `inspect`, or `custom`.
- `approval.preset`: `interactive`, `read_only`, `auto`, or `custom`.

The most common tool presets are:

- `default`: expose Heddle's normal runtime tool bundle.
- `inspect`: expose workspace-read and shell-inspection tools while denying
  mutation capabilities.
- `custom`: use explicit include, exclude, allow, or deny rules in the
  definition.

The most common approval presets are:

- `interactive`: ask before sensitive actions.
- `read_only`: for agents that should not make changes.
- `auto`: allow trusted local coding actions that match Heddle approval policy.

## Using Custom Agents

In the browser control plane:

1. Open Settings -> Agents.
2. Add a project agent, or inspect agents discovered from the project and user
   roots.
3. Open a chat session.
4. Use the composer plus menu to choose Ask, Code, Review, or a custom agent for
   the next prompt.

For one-shot CLI usage, `heddle ask` can select a custom agent:

```bash
heddle ask --agent repo-reviewer "Review the current workspace changes"
```

It can also use built-in modes:

```bash
heddle ask --mode ask "Explain this repository"
heddle ask --mode review "Review the current diff"
```

`heddle ask` defaults to `builtin:ask` when no agent or mode is specified.

## Custom Agents Versus Skills

Custom agents and Agent Skills are related, but they solve different problems.

Agent Skills are reusable instructions and resources the agent may load when a
task needs them. They do not choose the role for the turn.

Custom agents choose the role for the turn. They can change the prompt appendix,
tool visibility, approval profile, and runtime defaults. A custom agent can
still use active skills when its tool profile includes `read_agent_skill`.

Use a skill when you want to teach Heddle a reusable workflow. Use a custom
agent when you want a named role such as "Ask", "Repo Reviewer", "Docs Writer",
or "Release Operator" with specific tools and approval behavior.

