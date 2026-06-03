# Project Config

`src/core/project-config/` owns the `heddle.config.json` file contract.

The public adapter methods are intentionally small:

- `ProjectConfigService.resolvePath(workspaceRoot)` resolves the canonical
  config file path.
- `ProjectConfigService.read(workspaceRoot)` reads and validates the config,
  returning only supported fields and `{}` when the file is missing or invalid.
- `ProjectConfigService.initialize(workspaceRoot)` creates the default config
  template when absent and reports whether a file was created.

Terminal command adapters may call these methods directly. They should not
duplicate config defaults, parse JSON themselves, reinterpret invalid values, or
own template shape. Parsing, zod validation, and default template values stay
private to this domain.
