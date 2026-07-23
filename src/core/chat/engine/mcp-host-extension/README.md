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

## Self-contained (stateless) extensions

`prepareMcpHostExtension(...)` returns a **self-contained** extension: it embeds
the resolved server config and cached catalog, so at runtime the toolkit
resolves and executes tools from that embedded data instead of re-reading the
MCP config/catalog from `context.stateRoot`. This lets one prepared extension be
reused across many cheap, per-request engines — e.g. a multi-tenant server that
builds a fresh engine per request with a per-user API key and per-user storage,
without any per-engine MCP prep or a per-user `.heddle/` directory. Tool
execution stays stateless: each call creates a fresh MCP client plus its
configured transport (including a subprocess for stdio) and closes both.
All three transport paths receive the owning tool execution's abort signal.

A plain `defineMcpHostExtension(options)` with no embedded data keeps the
original behavior: the toolkit reads the server + catalog from `stateRoot` at
runtime (the local CLI-host path). Preparation passes the embedded data as the
optional second argument to `defineMcpHostExtension(options, resolved)`.

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

### Mirror mode (keep the value inline)

Replacement compaction breaks hosts whose MCP server is **stateless** — where
each tool call takes the current document as input and returns the updated
document (so the model must keep the full value inline for the next call).
For that shape, a manual rule can use `mode: 'mirror'`:

```ts
resultArtifacts: [{
  toolName: 'create-deck',
  path: 'structuredContent.result.source',
  mode: 'mirror',      // persist the artifact, leave the value inline untouched
  kind: 'source',
  setCurrent: true,    // host reads the outcome via engine.artifacts.current(...)
}]
```

The model keeps seeing the full value; the host gets a durable artifact and a
one-line way to read "the outcome of this turn". `replacePaths` is ignored in
mirror mode. When manual mirror rules and `auto` capture are combined, the
mirrored path and its descendants are excluded from the auto pass so the full
value remains inline as declared.

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
