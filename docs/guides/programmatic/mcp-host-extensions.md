# MCP Host Extensions

Use `prepareMcpHostExtension` when your product already has an MCP server and
you want Heddle to expose that server as host tools without copying MCP schemas
into hand-written `ToolDefinition` objects.

```ts
import { prepareMcpHostExtension } from '@roackb2/heddle'

const prepared = await prepareMcpHostExtension({
  id: 'document-workspace',
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  serverId: 'documents',
  server: {
    type: 'stdio',
    command: 'npm',
    args: ['run', 'mcp'],
    tools: { approval: 'never' },
  },
  hideDefaultMcpTools: true,
  resultArtifacts: true,
  systemContext: 'Use document tools for drafting, validation, and export.',
})

if (!prepared.ok) {
  throw new Error(`MCP setup failed at ${prepared.step}: ${prepared.error}`)
}
```

By default, all enabled tools from the refreshed MCP catalog are exposed. Use
tool filtering only when your host intentionally curates the surface:

```ts
const prepared = await prepareMcpHostExtension({
  id: 'document-workspace',
  workspaceRoot,
  stateRoot,
  serverId: 'documents',
  server,
  includeTools: ['create_document', 'validate_document'],
  excludeTools: ['delete_document'],
})
```

`hideDefaultMcpTools: true` hides the raw default MCP surface for that server.
The host extension still calls the same MCP server behind the scenes, but the
model sees the curated host tool names instead of both paths.

Use `toolNamePrefix` only when multiple MCP servers expose overlapping tool
names in the same engine. Use `toolOverrides` when a host needs a sharper
description, capability, approval setting, or public tool name.

`resultArtifacts: true` is the recommended starting point for MCP servers that
return generated source, HTML, JSON, or other large text outputs. Heddle scans
the MCP result, saves large strings as artifacts, and replaces duplicated
structured/text mirrors with the same compact artifact reference.
