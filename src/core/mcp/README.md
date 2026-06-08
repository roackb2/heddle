# MCP

`src/core/mcp` owns Heddle's Model Context Protocol compatibility boundary.

The domain is responsible for MCP server config parsing, workspace enablement
state, cached tool catalogs, connection lifecycle, and Heddle-facing call
semantics. It does not own UI rendering, slash-command presentation, or generic
tool dispatch.

## Data

- `.heddle/mcp.json`: user-authored MCP server config. Heddle accepts the common
  `mcpServers` shape and VS Code's `servers` alias.
- `.heddle/mcp/activation.json`: workspace server enablement state.
- `.heddle/mcp/catalog.json`: cached tools discovered from enabled servers.

Server config is not treated as permission. Enabling a server allows Heddle to
connect to it, but individual tool calls still go through Heddle's normal tool
and approval path.

## Boundaries

- `src/core/tools/toolkits/mcp` adapts cached MCP tool descriptors into Heddle
  `ToolDefinition`s.
- `src/core/runtime/tools` decides whether the MCP toolkit is included in the
  default runtime bundle.
- `src/core/approvals` remains the owner of approval semantics.
- `src/server`, `src/cli-v2`, and `src/web-v2` show or mutate MCP state through
  typed APIs and must not parse MCP config directly.

## Current Scope

The initial implementation supports local `stdio` servers and Streamable HTTP
servers through the official TypeScript MCP SDK. OAuth, registry import,
resources, prompts, and progressive tool search can be added after the basic
tool flow is stable.
