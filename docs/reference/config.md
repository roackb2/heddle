# Project Config

Heddle can store local workspace defaults in `.heddle/config.json` so you do not have to repeat the same workspace settings every run. Run `heddle init` to create the template.

Older workspaces with a root-level `heddle.config.json` still load for backward compatibility when `.heddle/config.json` is absent. New initialization writes only `.heddle/config.json` so Heddle does not create repository-root files by default.

## Example

```json
{
  "model": "gpt-5.4",
  "maxSteps": 100,
  "stateDir": ".heddle",
  "directShellApproval": "never",
  "searchIgnoreDirs": [".git", "dist", "node_modules", ".heddle"],
  "autopilot": {
    "mode": "interactive",
    "roots": [
      {
        "path": ".",
        "access": "manual-only"
      }
    ],
    "environments": {
      "allow": ["local", "dev"],
      "requireApproval": ["staging", "production", "unknown"]
    }
  }
}
```

## Precedence

Configuration is applied in this order:

1. CLI flags
2. `.heddle/config.json`
3. environment-driven defaults

## Field Notes

- `model`: default model for this workspace
- `maxSteps`: default agent-loop step budget
- `stateDir`: where Heddle stores sessions, traces, approvals, logs, and memory. This does not move the config file itself; local config stays at `.heddle/config.json`.
- `directShellApproval`: whether explicit `!command` usage in chat still requires approval
- `searchIgnoreDirs`: directories excluded from routine `search_files` calls
- `agentContextPaths`: optional project instruction files injected into the system prompt. When omitted, Heddle loads the first non-empty file found in this order: `HEDDLE.md`, `AGENTS.md`, `CLAUDE.md`. Only one default file is loaded to preserve context space. If configured, Heddle uses the listed paths exactly, so advanced projects can opt into custom names or multiple files.
- `autopilot`: optional approval autonomy profile. `mode: "interactive"` keeps
  ordinary approval behavior. `mode: "autopilot"` lets matching tool calls run
  without manual approval when the agent honestly declares a compatible policy
  envelope and the runtime-computed facts match the configured roots,
  capabilities, and environments. Hard-deny rules still block destructive
  actions before remembered approvals.

`autopilot.roots[].path` should be a project/workspace boundary, usually a git
repository root or a folder with config such as `package.json`,
`requirements.txt`, `pyproject.toml`, `Cargo.toml`, or `go.mod`. Use the
narrowest project root involved, not individual file paths.

`autopilot.roots[].access` accepts:

- `read`: read-only claims can run unattended.
- `write`: write-like claims may run unattended only when listed capabilities
  allow them.
- `autopilot`: the root is eligible for unattended work, still constrained by
  capabilities.
- `manual-only`: matching calls require manual approval.
- `deny`: matching calls are denied before approval fallback.

Common capabilities include `read`, `write`, `execute`, `simple-delete`,
`many-file-edit`, `verification`, `formatting`, `dependency`, and `git-stage`.

## When To Use Config

`.heddle/config.json` is useful when:

- a project consistently uses the same model
- you want a non-default state directory
- you want predictable shell approval behavior in a shared workflow
- your repository has directories that should stay out of routine search unless explicitly targeted
- the project relies on custom instruction paths beyond the default `HEDDLE.md`, `AGENTS.md`, or `CLAUDE.md` discovery order
- you want unattended local/dev coding work inside specific project roots while
  keeping dangerous roots, production-like environments, and broad destructive
  actions approval-gated or denied

## See Also

- [CLI reference](cli.md)
- [Chat and sessions](../guides/chat-and-sessions.md)
- [Development and contributing](../guides/development.md)
