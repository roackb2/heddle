# SDK Examples

These examples climb the programmatic ladder, from the smallest interactive host
toward more customized Heddle SDK usage. See the
[programmatic guide index](../../docs/guides/programmatic/README.md) for the
matching docs.

## 01 Interactive Chat (rung 1: start here)

```bash
yarn example:sdk:interactive
```

A persisted conversation loop with default text output and local commands. The
recommended first file to copy when trying Heddle as a framework.

## 02 Add a Tool (rung 2: add capabilities)

```bash
yarn example:sdk:add-tool
```

Defines one `ToolDefinition` and hands it to the runner. This is the smallest
way to give the agent a capability of your own.

## 03 Add an MCP Server (rung 2: add capabilities)

```bash
yarn example:sdk:add-mcp
```

Uses `prepareMcpHostExtension` to expose an MCP server's tools as curated Heddle
tools. Edit the server `command`/`args` to point at a real MCP server.

## 04 Custom Output (rung 3: shape input/output)

```bash
yarn example:sdk:custom-output
```

Drives `createConversationEngine` directly and sends streaming text to a custom
destination via `createConversationTextHost`. Replace the `output` sink with your
own transport (web, chat, log collector).
