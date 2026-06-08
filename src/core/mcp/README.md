# MCP

`src/core/mcp` owns Heddle's Model Context Protocol compatibility boundary.

The domain is responsible for MCP server config parsing, workspace enablement
state, cached tool catalogs, connection lifecycle, and Heddle-facing call
semantics. It does not own UI rendering, slash-command presentation, or generic
tool dispatch.

## Product Model

MCP support is a user-configured integration surface. A user can configure
servers for services such as Notion, Anytype, GitHub, or any other MCP server
they trust. Heddle then acts as the MCP host:

1. read configured MCP servers;
2. let the user enable a server for this workspace;
3. connect to enabled servers on explicit refresh and cache their tool catalog;
4. expose cached MCP tools through Heddle's existing tool system;
5. route tool calls through Heddle approval and trace boundaries.

Server config is not permission by itself. Enabling a server allows Heddle to
connect to it, but individual tool calls remain normal Heddle tool calls.

Users can configure servers by editing `.heddle/mcp.json` directly, running
`/mcp config` from a host that supports file opening, or pasting a full MCP JSON
document into Settings -> MCP. All of those paths target the same config file.

## State Files

`src/core/mcp` owns three workspace-local files:

- `.heddle/mcp.json`
  - user-authored MCP server config;
  - accepts the common `mcpServers` shape and VS Code's `servers` alias;
  - supports `stdio`, `http`, normalized `streamable-http`, and legacy `sse`.
- `.heddle/mcp/activation.json`
  - Heddle-owned workspace state;
  - stores only whether a configured server is enabled or disabled;
  - does not copy or mutate the server config.
- `.heddle/mcp/catalog.json`
  - Heddle-owned cached discovery state;
  - stores the latest discovered tools for enabled servers;
  - lets runtime tool assembly stay synchronous.

Do not store tokens or resolved secret values in these state files. Config may
contain env references such as `${env:NOTION_TOKEN}`; runtime connection code
resolves those at the boundary where the SDK transport is created.

## Why Cached Catalogs Exist

`RuntimeToolService.createDefaultAgentTools()` and `ToolToolkit.createTools()`
are synchronous today. MCP discovery is async because Heddle must launch or
connect to a server and call `tools/list`.

To avoid refactoring the whole runtime tool assembly path, this first MCP slice
uses explicit refresh:

```text
.heddle/mcp.json
  -> /mcp enable notion
  -> /mcp refresh notion
  -> .heddle/mcp/catalog.json
  -> src/core/tools/toolkits/mcp
  -> agent-visible Heddle tools
```

That means normal agent turns read cached tool descriptors instead of blocking
startup on MCP discovery. If future product work needs live discovery every
turn, make the runtime tool assembly path async first; do not hide async MCP
work inside a synchronous toolkit.

## Main Classes

- `FileMcpConfigRepository`
  - resolves `.heddle/mcp.json`;
  - creates the default `{ "mcpServers": {} }` document when an edit/open flow
    needs a concrete file;
  - reads/writes the raw JSON document for user-facing config editors;
  - parses standard `mcpServers` and VS Code `servers`;
  - normalizes transport names and validates server ids;
  - returns issues instead of throwing for user-facing config errors.
- `FileMcpActivationRepository`
  - reads/writes `.heddle/mcp/activation.json`;
  - stores workspace user decisions only.
- `FileMcpCatalogRepository`
  - reads/writes `.heddle/mcp/catalog.json`;
  - stores discovered tools from successful refreshes.
- `McpClientService`
  - owns the official `@modelcontextprotocol/sdk` client usage;
  - creates stdio, Streamable HTTP, or legacy SSE transports;
  - lists tools and calls tools;
  - closes client and transport resources after each operation.
- `McpService`
  - owns Heddle-level semantics on top of repositories and SDK calls;
  - exposes config document read/create/save methods for control-plane hosts;
  - builds UI/API server views;
  - enables/disables servers;
  - refreshes catalogs for enabled servers;
  - gates tool calls against enablement, cached catalog presence, and allow/deny
    policy before delegating to `McpClientService`.

## Boundaries

- `src/core/tools/toolkits/mcp` adapts cached MCP tool descriptors into Heddle
  `ToolDefinition`s.
- `src/core/runtime/tools` decides whether the MCP toolkit is included in the
  default runtime bundle.
- `src/core/approvals` remains the owner of approval semantics.
- `src/server`, `src/cli-v2`, and `src/web-v2` show or mutate MCP state through
  typed APIs and must not parse MCP config directly.

## Runtime Tool Flow

The runtime MCP toolkit exposes:

- `mcp_list_tools`
  - reads Heddle MCP state;
  - lists enabled servers and cached tools;
  - does not launch servers and does not grant permission.
- `mcp_call_tool`
  - accepts `{ serverId, toolName, arguments }`;
  - is approval-gated;
  - keeps MCP tool arguments nested under `arguments` so Heddle's top-level
    policy envelope cannot collide with a remote MCP tool's own `policy` field.
- cached per-tool adapters such as `mcp__notion__search_pages`
  - created only from cached catalog records;
  - use Heddle-safe namespaced names;
  - preserve the original server id and MCP tool name when calling `McpService`.

The toolkit should stay an adapter. It should not parse config, manage
enablement, launch servers, or decide policy beyond setting Heddle
`ToolDefinition` metadata.

## Slash Commands And Web UI

Shared slash commands live in `src/core/commands/slash/modules/mcp/`.
They talk to a typed `mcp` port on `SlashCommandExecutionContext`.

Control-plane routes live in `src/server/controllers/trpc/control-plane/mcp.ts`
and `src/server/routes/trpc/control-plane.ts`.

The web settings page lives in `src/web-v2/components/settings/McpSettingsView.tsx`.
It renders state and calls control-plane mutations. Its JSON editor reads and
saves the config document through control-plane routes; it must not read
`.heddle/mcp.json` directly or duplicate MCP state logic.

`/mcp config` is a shared slash command, but opening a file is host/OS behavior.
The slash command asks the typed `mcp` port to open the config file. The
control-plane execution context ensures the config document exists and then
spawns the platform file opener. Keep that OS-specific opener outside
`src/core/mcp`; the MCP domain owns the document, not desktop lifecycle.

## Policy Rules

Keep these invariants:

- Configured does not mean enabled.
- Saving config does not enable servers or refresh cached tools.
- Enabled does not mean trusted for unattended execution.
- Tool calls still go through Heddle approval and tracing.
- MCP server/tool descriptions and outputs are untrusted external content.
- Local stdio servers run commands with the user's OS permissions.
- Secret values should be resolved at connection time and redacted from
  diagnostics/logs where possible.

Server-level tool policy is intentionally small:

- `tools.deny` blocks named MCP tools.
- `tools.allow`, when present, exposes only named MCP tools.
- `tools.approval: "never"` can make cached per-tool adapters non-approval
  gated, but the broker `mcp_call_tool` remains approval-gated in this slice.

Do not treat MCP tool annotations such as read-only or destructive hints as
Heddle permissions until an approval-domain design explicitly supports that.

## Extension Rules

- Add transport/auth behavior inside `McpClientService`.
- Add persisted MCP state only through repository schemas in this folder.
- Add user-visible state by extending `McpService.listOverview()`.
- Add config document behavior through `FileMcpConfigRepository` and
  `McpService`, then expose it through control-plane APIs.
- Add runtime tool exposure through `src/core/tools/toolkits/mcp`.
- Add terminal/web controls through control-plane APIs, not by importing this
  service directly into host components.
- Keep config normalization deterministic. Bad server entries should produce
  issues while preserving other valid servers.

## Current Scope And Deferred Work

The initial implementation supports local `stdio` servers and Streamable HTTP
servers through the official TypeScript MCP SDK. OAuth, registry import,
resources, prompts, and progressive tool search can be added after the basic
tool flow is stable.

Deferred work should be implemented as separate slices:

- remote OAuth and secure token storage;
- MCP registry import;
- resources and prompts;
- large-catalog search/progressive discovery;
- async live discovery during runtime tool assembly.
