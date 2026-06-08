# MCP Integrations

Heddle can act as a Model Context Protocol host. This lets a workspace connect
to user-configured MCP servers for services such as Notion, Anytype, GitHub, or
other ecosystem tools without Heddle building a bespoke integration for each
service.

MCP support is workspace-scoped and operator-controlled:

1. configure servers in `.heddle/mcp.json`;
2. enable the server for the workspace;
3. refresh its cached tool catalog;
4. let the agent call cached MCP tools through Heddle's normal tool, approval,
   and trace path.

## Config

Heddle reads MCP server declarations from `.heddle/mcp.json`.

The primary shape is the common `mcpServers` JSON format:

```json
{
  "mcpServers": {
    "notion": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "notion-mcp-server"],
      "env": {
        "NOTION_TOKEN": "${env:NOTION_TOKEN}"
      }
    },
    "anytype": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:ANYTYPE_TOKEN}"
      }
    }
  }
}
```

Heddle also accepts VS Code-style `servers` as an import-compatible alias. If
both keys define the same server id, `mcpServers` takes precedence.

Supported transport values:

- `stdio`
- `http`
- `streamable-http`, normalized to HTTP internally
- `sse`, for legacy compatibility

## Commands

Use slash commands from chat:

```text
/mcp
/mcp enable <server>
/mcp disable <server>
/mcp refresh <server>
```

`/mcp refresh <server>` connects to an enabled server and writes the discovered
tool list to `.heddle/mcp/catalog.json`. Runtime tool assembly reads this cache
so normal agent turns do not need to block on MCP discovery.

## Web Settings

The browser control plane includes Settings -> MCP. It shows configured,
enabled, disabled, and missing servers, plus cached tool counts and refresh
actions.

## Agent Tools

When MCP servers are configured, Heddle exposes:

- `mcp_list_tools`: lists enabled servers and cached MCP tools;
- `mcp_call_tool`: approval-gated broker call for an enabled server/tool;
- cached per-tool names such as `mcp__notion__search_pages` after refresh.

MCP calls are external actions. They remain subject to Heddle's approval and
trace behavior.

## Safety

MCP server config is not permission by itself. Enabling a server allows Heddle
to connect to it, but tool calls still flow through Heddle's runtime policy.

Local `stdio` servers execute commands with the user's OS permissions. Review
the command, args, and environment references before enabling or refreshing a
server.

MCP tool descriptions, resources, prompts, and outputs are external content.
Treat them as untrusted input, especially when connecting to community servers.

