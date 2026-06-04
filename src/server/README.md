# Server

`src/server` owns the local control-plane HTTP server and transport adapters
over core runtime behavior. It is not a product surface like the TUI or web UI.

## Lifecycle

`lifecycle.ts` owns the reusable control-plane server lifecycle:

- validate optional web assets;
- create the shared Express app;
- bind and close the HTTP server;
- register and refresh the global live-server record;
- register known workspaces from the runtime workspace catalog;
- start, sync, and stop the heartbeat scheduler host.

The lifecycle handle returns server facts such as `serverId`, endpoint, registry
path, workspace bootstrap roots, and `close()`.

CLI-only behavior stays outside this module. Command adapters such as
`src/cli-v2/commands/daemon-command.ts` decide whether to attach to an existing
live server, print messages, install signal handlers, and call `process.exit()`.

Embedded hosts such as future `chat-v2` startup should use the same lifecycle
path instead of inventing a TUI-only server path.
