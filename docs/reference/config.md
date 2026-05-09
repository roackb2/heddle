# Project Config

Heddle can store project defaults in `heddle.config.json` so you do not have to repeat the same workspace settings every run.

## Example

```json
{
  "model": "gpt-5.4",
  "maxSteps": 100,
  "stateDir": ".heddle",
  "directShellApproval": "never",
  "searchIgnoreDirs": [".git", "dist", "node_modules", ".heddle"]
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
- `searchIgnoreDirs`: directories excluded from routine `search_files` calls
- `agentContextPaths`: optional project instruction files injected into the system prompt. When omitted, Heddle loads the first non-empty file found in this order: `HEDDLE.md`, `AGENTS.md`, `CLAUDE.md`. Only one default file is loaded to preserve context space. If configured, Heddle uses the listed paths exactly, so advanced projects can opt into custom names or multiple files.

## When To Use Config

`heddle.config.json` is useful when:

- a project consistently uses the same model
- you want a non-default state directory
- you want predictable shell approval behavior in a shared workflow
- your repository has directories that should stay out of routine search unless explicitly targeted
- the project relies on custom instruction paths beyond the default `HEDDLE.md`, `AGENTS.md`, or `CLAUDE.md` discovery order

## See Also

- [CLI reference](cli.md)
- [Chat and sessions](../guides/chat-and-sessions.md)
- [Development and contributing](../guides/development.md)
