# Project Config

`src/core/project-config/` owns the `.heddle/config.json` file contract.

The public adapter methods are intentionally small:

- `ProjectConfigService.resolvePath(workspaceRoot)` resolves the canonical
  local config file path.
- `ProjectConfigService.read(workspaceRoot)` reads and validates the config,
  returning only supported fields and `{}` when the file is missing or invalid.
- `ProjectConfigService.initialize(workspaceRoot)` creates the default config
  template when absent and reports whether a file was created.
- The optional `autopilot` field uses the approval autonomy profile schema from
  `src/core/approvals/autonomy/`. Project config validates the persisted shape,
  but approval semantics and policy decisions stay in the approvals domain.

Terminal command adapters may call these methods directly. They should not
duplicate config defaults, parse JSON themselves, reinterpret invalid values, or
own template shape. Parsing, zod validation, and default template values stay
private to this domain.

For backward compatibility, `read` also accepts a legacy root-level
`heddle.config.json` when `.heddle/config.json` is absent. New initialization
must write only the local `.heddle/config.json` path so Heddle does not create
repo-root files by default.
