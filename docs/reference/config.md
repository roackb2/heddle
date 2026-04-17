# Project Config

Heddle can store project defaults in `heddle.config.json` so you do not have to repeat the same workspace settings every run.

## Example

```json
{
  "model": "gpt-5.1-codex",
  "maxSteps": 100,
  "stateDir": ".heddle",
  "directShellApproval": "never",
  "searchIgnoreDirs": [".git", "dist", "node_modules", ".heddle"],
  "agentContextPaths": ["AGENTS.md"]
}
```

## Precedence

Configuration is applied in this order:

1. CLI flags
2. `heddle.config.json`
3. environment-driven defaults

## Field Notes

- `model`: default model for this workspace
- `maxSteps`: default agent-loop step budget
- `stateDir`: where Heddle stores sessions, traces, approvals, logs, and memory
- `directShellApproval`: whether explicit `!command` usage in chat still requires approval
- `searchIgnoreDirs`: directories excluded from `search_files`
- `agentContextPaths`: project instruction files injected into the system prompt

## When To Use Config

`heddle.config.json` is useful when:

- a project consistently uses the same model
- you want a non-default state directory
- you want predictable shell approval behavior in a shared workflow
- your repository has directories that should stay out of routine search
- the project relies on one or more instruction files such as `AGENTS.md`

## See Also

- [CLI reference](cli.md)
- [Chat and sessions](../guides/chat-and-sessions.md)
- [Development and contributing](../guides/development.md)
