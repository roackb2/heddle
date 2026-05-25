# Control Plane

Heddle includes a local browser control plane for workspace oversight when you want a browser UI in addition to terminal chat.

The control plane is the main place to inspect saved sessions, review evidence, workspace memory health, heartbeat tasks, run history, and local workspace switching.

## What The Control Plane Includes

Current stack:

- `src/server`: Express-hosted tRPC server
- `src/web`: React/Vite web client
- `src/web-v2`: React/Vite web-v2 client for new control-plane work
- `src/server/routes`, `src/server/controllers`, and `src/server/services`: control-plane server API routes, request controllers, and domain services
- pino logs written locally for debugging

The current browser UI surfaces:

- active workspace and `.heddle/` state location
- workspace management with registered workspaces, recent known workspaces, folder picking, switching, and renaming
- saved chat sessions with sidebar navigation, resizable desktop panels, conversation view, and review-oriented detail inspection
- browser-side session actions for new session, send, continue, cancel, and pending approval resolution
- live per-session updates for run status, tool progress, approval waits, assistant streaming text, thinking summaries, and saved-session changes
- a model selector and reasoning-effort control backed by the server-side built-in model catalog and session state, plus a drift toggle and latest trace-derived drift level
- an auth status indicator in the session composer footer so you can see whether the selected model is using OAuth or API-key mode without spending header space
- debounced `@file` mention suggestions in the composer, backed by a capped workspace file search endpoint
- compact tool-result cards for saved tool outputs such as `list_files: {...}`
- current workspace review backed by Git status and file patches, so generated or shell-made changes are visible even when they did not come from the edit tool
- historical turn review for trace-backed file diffs, review commands, verification commands, approvals, and events
- lightweight toast notifications for session/action success and failure
- heartbeat task status, scheduling state, selected task detail, and run history
- recent heartbeat run summaries and usage data

Live session updates come from the daemon's per-session event stream. Web-v2
uses the `controlPlane.sessionEvents` tRPC subscription for those updates; the
legacy browser surface still has an SSE compatibility path. In both cases,
streaming activity is separate from durable session refreshes: assistant/tool
progress arrives as live activity, while saved-session changes tell the browser
to refetch persisted session detail.

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

## Review Experience

The `Review` view is designed to help you review the task in front of you, not to dump every trace artifact into one feed.

It has three review modes:

- `Current`: the live Git working tree for the active workspace. This is the default because it answers what you need to review before committing or reverting.
- `Turn history`: the selected turn's captured file diffs from traces. This is historical evidence and may differ from the current workspace if later edits happened.
- `Evidence`: review commands, verification commands, approvals, and trace events for the selected turn.

Current review uses Git as the source of truth for changed files. It reads workspace status and selected file patches, filters out `.heddle/` runtime state, renders structured hunks when available, and falls back to raw patch text for unsupported patches. The side panel stays focused on the selected file, and `Open full diff` expands the same diff into a larger review surface when the side panel is too constrained.

Turn history remains trace-backed. It is useful for answering what the agent did at that moment, what commands it ran, and what it believed it verified. If the current workspace patch no longer matches the captured turn patch, Heddle marks that stale relationship with a compact info indicator instead of spending review space on a warning card.

Conversation messages render GitHub-flavored markdown for headings, lists, task lists, code fences, links, and inline formatting. Thinking summaries stay visually distinct from final assistant responses, so they help explain what the agent is doing without pretending to be the user-facing answer.

This is still intentionally short of a full IDE file-review engine: Heddle does not edit patches in the browser and does not rely on OS file watching as the review truth. The practical review model is: Git shows what changed now; traces explain how the selected turn got there.

## Mobile Layout

The control plane includes a mobile-native layout for phone and tablet access. It is designed around short navigation paths rather than shrinking the desktop workstation view into a narrow screen.

On mobile, the UI uses:

- bottom root navigation for Overview, Sessions, Tasks, and Workspaces
- a dedicated session list for choosing saved conversations
- native-style session navigation for Chat and Review
- a compact composer that keeps the latest conversation visible
- current workspace diff review plus historical turn/evidence tabs without desktop sidebars
- full-diff expansion for reviewing larger patches on small screens

Representative mobile views:

<p>
  <img src="../images/mobile-control-plane-overview-current.png" alt="Heddle mobile overview" width="240">
  <img src="../images/mobile-control-plane-session-chat.png" alt="Heddle mobile chat view" width="240">
  <img src="../images/mobile-control-plane-session-review-current-diff.png" alt="Heddle mobile current diff review" width="240">
  <img src="../images/mobile-control-plane-workspaces-current.png" alt="Heddle mobile workspace management" width="240">
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

If you have both a stored OpenAI OAuth credential and an API key, and you want the control plane to use API-key mode for that daemon session, start it with:

```bash
heddle --prefer-api-key daemon
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

The control plane is useful today as a local workstation surface for sessions, workspace switching, Git-backed current review, trace-backed turn evidence, heartbeat visibility, and mobile oversight. The main product boundary is that file review is read-only and Git-backed rather than an editable IDE diff surface or live file watcher.

## See Also

- [Chat and sessions](chat-and-sessions.md)
- [Heartbeat guide](heartbeat.md)
- [CLI reference](../reference/cli.md)
