# Control Plane

Heddle includes a local browser control plane for workspace oversight when you want a browser UI in addition to terminal chat.

The control plane is the main place to inspect saved sessions, review evidence, workspace memory health, heartbeat tasks, run history, and local workspace switching.

## What The Control Plane Includes

Current stack:

- `src/server`: Express-hosted tRPC server
- `src/web`: React/Vite web client
- `src/server/features/control-plane`: control-plane-specific server feature logic
- pino logs written locally for debugging

The current browser UI surfaces:

- active workspace and `.heddle/` state location
- workspace management with registered workspaces, recent known workspaces, folder picking, switching, and renaming
- saved chat sessions with sidebar navigation, resizable desktop panels, conversation view, and review-oriented detail inspection
- browser-side session actions for new session, send, continue, cancel, and pending approval resolution
- live per-session updates over SSE for run status, tool progress, assistant streaming text, and saved-session changes
- a model selector backed by the server-side built-in model catalog, plus a drift toggle and latest trace-derived drift level
- debounced `@file` mention suggestions in the composer, backed by a capped workspace file search endpoint
- compact tool-result cards for saved tool outputs such as `list_files: {...}`
- changed-file review with structured diff excerpts when the trace contains file edits or git diff evidence
- review and verification command evidence grouped separately from approvals and events
- lightweight toast notifications for session/action success and failure
- heartbeat task status, scheduling state, selected task detail, and run history
- recent heartbeat run summaries and usage data

## Workspaces

A workspace is the project state Heddle is currently operating on. For users, the important rule is simple: a workspace is the local project plus its `.heddle/` state.

The control plane exposes this as a top-level `Workspaces` section. From there you can:

- see workspaces attached to the current control-plane catalog
- switch the UI to another workspace
- rename a workspace entry
- add a workspace by typing a path or choosing a folder
- reopen recently known workspaces discovered through the user-level registry

The folder picker is meant for choosing project roots without restarting the daemon by hand. It lets you navigate up and down the local folder tree, hides dot-prefixed folders by default, and can select a folder as the workspace path.

Heddle also maintains a small user-level registry of workspaces it has seen. This is why a project opened from the CLI can later appear as a known workspace in the browser UI. The registry is discovery metadata only; the authoritative project state remains in that workspace's `.heddle/` directory.

## Review Evidence

The `Review` view is designed to answer: "What changed, what did the agent run, and what evidence do I have before trusting this turn?"

When available, Heddle shows:

- changed files for the selected turn
- file-level status such as modified, added, or deleted
- diff excerpts from edit tools or git diff evidence
- review commands such as `git status --short` or `git diff --stat`
- verification commands such as tests, builds, or typechecks
- approval and trace events that explain what the agent requested or executed

This is not a full IDE file-review engine yet. It is trace-backed review evidence focused on the agent turn, so it works best when Heddle uses its built-in edit tools or runs explicit git review commands after a change.

## Mobile Layout

The control plane includes a mobile-native layout for phone and tablet access. It is designed around short navigation paths rather than shrinking the desktop workstation view into a narrow screen.

On mobile, the UI uses:

- bottom root navigation for Overview, Sessions, Tasks, and Workspaces
- a dedicated session list for choosing saved conversations
- native-style session navigation for Chat, Info, and Review
- a compact composer that keeps the latest conversation visible
- reachable session review and approval evidence without desktop sidebars

Representative mobile views:

<p>
  <img src="../images/mobile-control-plane-sessions.png" alt="Heddle mobile session list" width="240">
  <img src="../images/mobile-control-plane-chat.png" alt="Heddle mobile chat view" width="240">
  <img src="../images/mobile-control-plane-review.png" alt="Heddle mobile review evidence" width="240">
</p>

## Start The Daemon

Start the daemon from a workspace:

```bash
heddle daemon
```

By default, the daemon binds to `127.0.0.1:8765` and serves the built web app plus the tRPC API.

You can override host and port:

```bash
heddle daemon --host 127.0.0.1 --port 8765
```

The server writes pino logs to `.heddle/logs/server.log` by default. Override the path with:

```bash
HEDDLE_SERVER_LOG_FILE=/path/to/server.log heddle daemon
```

## Development Mode

For local development, run the server and client separately:

```bash
yarn daemon:dev
yarn client:dev
```

`yarn daemon:dev` starts the real daemon runtime at `127.0.0.1:8765`, including daemon ownership registration, registry heartbeats, and the built web app from `dist/src/web`.

`yarn client:dev` starts the Vite web client at `127.0.0.1:5173` and proxies `/trpc` and `/control-plane` requests to the backend server.

In other words:

- development mode uses two services:
  - daemon-backed app/API on `8765`
  - Vite frontend on `5173`
- built daemon mode uses one service:
  - `heddle daemon` serves both the built web client and the backend API on the same port

If you only want a lighter backend API process without daemon registration or built static serving, `yarn server:dev` still exists. That path is for server development, not for testing daemon ownership behavior.

When using `yarn daemon:dev`, rebuild after frontend changes:

```bash
yarn build
yarn daemon:dev
```

For built/local operator usage inside this repository, run:

```bash
yarn build
node dist/src/cli/main.js daemon --host 127.0.0.1 --port 8765
```

If you add or change control-plane tRPC routes, restart the daemon or backend server process. Vite hot reload updates the browser bundle only; a still-running daemon will not know about new procedures and may return `No procedure found on path ...`.

## Remote Control With Tailscale

If you want to access the control plane from another laptop, phone, or tablet, Tailscale is the recommended local-first remote access path.

### Why Tailscale

Tailscale lets you keep Heddle running on your workstation while reaching it from your other devices over a private tailnet. This avoids exposing the daemon directly to the public internet.

### Recommended Setup

1. Run the daemon locally:

```bash
yarn build
node dist/src/cli/main.js daemon --host 127.0.0.1 --port 8765
```

2. Put Tailscale Serve in front of it:

```bash
tailscale serve --bg http://127.0.0.1:8765
```

3. Check the active Serve status:

```bash
tailscale serve status
```

You should see an HTTPS `*.ts.net` URL that proxies to `http://127.0.0.1:8765`.

4. Open that HTTPS `*.ts.net` URL from another device on your tailnet.

### Important Notes

- For home-screen or app-like use on iPhone, use the HTTPS `*.ts.net` hostname, not a raw `http://100.x.x.x:8765` Tailscale IP.
- If you previously saved a home-screen icon from an HTTP URL, delete it and re-add it from the HTTPS hostname.
- `tailscale serve --bg http://127.0.0.1:8765` publishes the daemon inside your tailnet. You do not need Funnel for ordinary private remote control.
- If port `8765` is already in use, stop the old process or use another port and update the Serve target accordingly.

### Example Flow

```bash
yarn build
node dist/src/cli/main.js daemon --host 127.0.0.1 --port 8765
tailscale serve --bg http://127.0.0.1:8765
tailscale serve status
```

Then open the reported `https://<machine-name>.<tailnet>.ts.net` URL.

## Current Status

The control plane is useful today as a local workstation surface for sessions, workspace switching, review evidence, heartbeat visibility, and mobile oversight. The main product boundary is that file review is trace-backed rather than a full IDE-grade live file watcher. That keeps review evidence inspectable and reliable for the current agent turn while leaving room for deeper future file-review workflows.

## See Also

- [Chat and sessions](chat-and-sessions.md)
- [Heartbeat guide](heartbeat.md)
- [CLI reference](../reference/cli.md)
