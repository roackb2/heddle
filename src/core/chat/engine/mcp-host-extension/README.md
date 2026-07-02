# MCP Host Extension

This module owns the bridge from a configured MCP server to Heddle host
extensions. It is intentionally generic: no product-specific MCP server, tool
name, or result shape should be hard-coded here.

## Public Surface

Use these package-level helpers for SDK code:

```ts
prepareMcpHostExtension(...)
defineMcpHostExtension(...)
```

Those helpers are stable entrypoints. The implementation behind them is split
into services so future changes have one clear owner.

## Service Boundaries

- `McpHostExtensionService` composes the Heddle host extension shell. Keep this
  as the facade only.
- `McpHostExtensionPreparationService` owns setup state: write MCP config,
  activate server, refresh catalog, and return a prepared extension.
- `McpHostToolDefinitionService` owns converting cached MCP descriptors into
  Heddle `ToolDefinition`s: filtering, host tool names, descriptions, approval
  defaults, and wrapping tool execution.
- `McpResultArtifactService` owns the result-artifact policy entrypoint. It
  resolves manual rules and beginner-friendly auto capture.
- `McpAutoResultArtifactService` owns auto capture heuristics for
  `resultArtifacts: true`: scan large string outputs, infer kind/extension,
  save artifacts, and replace duplicate payloads with compact references.
- `McpStructuredContentMirrorService` owns the MCP compatibility case where
  `content[].text` is a JSON serialization of `structuredContent` or
  `structuredContent.result`.
- `McpArtifactPathService` owns path normalization, matching, and result object
  mutation. If an option or trace says `structuredContent.result.html`, this is
  where that vocabulary is interpreted.
- `McpHostValueService` owns safe type guards and serialization for unknown MCP
  JSON-ish values.

## Extending Result Artifacts

Prefer improving auto capture before asking SDK users for paths. A first-time
host author should be able to write:

```ts
resultArtifacts: true
```

Only add public options such as `path`, `pathIncludes`, or explicit
`replacePaths` for advanced cases where inference cannot be reliable. When a
new inference is added, cover it in
`src/__tests__/unit/core/mcp-host-extension.test.ts`.

## Maintenance Rules

- Do not add product-specific behavior here. Product hosts should pass prompts,
  tool policy, or optional hints from outside Heddle.
- Do not add standalone implementation functions. New behavior should belong to
  the service that owns that boundary.
- Keep public compatibility exports in `index.ts` small. Actual behavior should
  live on the services above.
- Add short inline comments only for non-obvious behavior, especially where MCP
  compatibility requires preserving both structured and text output semantics.
