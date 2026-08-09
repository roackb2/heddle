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

## Short-lived capabilities for hosted products

Use request-scoped preparation when a trusted product backend gives one agent
invocation a short-lived capability for a fixed remote MCP server:

```ts
import { prepareMcpHostExtension } from '@roackb2/heddle'

const prepared = await prepareMcpHostExtension({
  mode: 'request-scoped',
  id: 'product-capabilities',
  serverId: 'product_backend',
  server: {
    transport: 'http',
    url: 'https://product.example.com/mcp',
    tools: {
      allow: ['read_workspace', 'publish_finding'],
      approval: 'never',
    },
  },
  includeTools: ['read_workspace', 'publish_finding'],
  tenantId: verifiedIdentity.tenantId,
  signal: invocationSignal,
  resolveRequestHeaders: async ({ operation, serverId, signal }) => ({
    Authorization: `Bearer ${await capabilities.forMcp({ operation, serverId, signal })}`,
  }),
})

if (!prepared.ok) {
  throw new Error(`MCP setup failed at ${prepared.step}: ${prepared.error}`)
}
```

Request-scoped mode supports HTTP and SSE only. The server declaration has no
`headers` field: `resolveRequestHeaders` returns the complete header set for a
fresh transport, separately for discovery and each tool call. Heddle does not
write the server, catalog, callback, or returned headers to `.heddle`, and it
does not fall back to environment variables when resolution fails.

Create the callback only after the product has authenticated the caller and
verified an immutable adopter/tenant/user/session scope. Keep that identity in
the closure rather than tool arguments, and bind the prepared extension to one
scope (normally one engine invocation). The remote MCP server must independently
verify expiry, audience, scope, and allowed tools. Heddle transports the
capability but does not interpret the product's authorization claims.
