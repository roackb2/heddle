# Runtime Host Model

Heddle is local-first, but interactive clients are no longer separate runtimes
that each invent their own workspace ownership rules.

The current model is:

> One local control-plane server path, many clients, explicit workspace identity
> per request.

This guide explains how terminal chat, `ask`, the daemon, and the browser
control plane fit together.

## The Short Version

Heddle has three important pieces:

- **Workspace state**: the project-local `.heddle/` directory that stores
  sessions, traces, memory, uploads, heartbeat tasks, and run records.
- **Control-plane server**: the local HTTP/tRPC/SSE server that exposes shared
  chat/session/workspace behavior to terminal and browser clients.
- **Client active workspace**: the workspace selected by a terminal or browser
  client. Workspace-scoped requests carry that workspace identity to the server.

The server should not be understood as owning one global active workspace.
Clients choose a workspace, send `workspaceId`, and the server resolves the
request workspace at the API boundary.

## How Chat Starts

The default terminal chat is the API-backed TUI v2 path:

```bash
heddle
heddle chat
```

When chat starts, it checks for a live local control-plane server:

- if a live server exists, chat attaches to it;
- if no live server exists, chat starts an embedded control-plane server in the
  same process;
- either way, the TUI talks to the shared control-plane API after bootstrap.

## Daemon Mode

The daemon starts the same control-plane server path as a standalone process:

```bash
heddle daemon
```

Use daemon mode when you want:

- the browser control plane;
- a longer-lived local server;
- browser or mobile oversight while terminal clients come and go;
- workspace switching from the browser UI.

If a live control-plane server already exists, the daemon command should attach
to that fact, print the existing server address, and exit successfully instead
of starting a competing server.

## Browser Control Plane

The browser control plane is a client of the local control-plane server. It is
not a second independent runtime.

The browser keeps its own selected workspace state. When you switch workspace
in the browser, browser requests carry that workspace identity. A terminal TUI
launched from another directory can use a different active workspace against the
same live server.

That is the intended shape:

- one local server path;
- separate client active workspace state;
- request-scoped workspace resolution on the server.

## What Counts As A Workspace

A Heddle workspace is the local project scope Heddle is operating on.

In the simplest case, it is the directory you started Heddle from. For users, a
workspace is the project folder plus its `.heddle/` state.

By default, Heddle stores workspace-local state under:

```text
<workspace>/.heddle/
```

That includes:

- saved chat sessions;
- heartbeat tasks and run history;
- memory notes;
- traces;
- uploads;
- workspace metadata.

This is intentional. Heddle is designed so operational state stays readable and
local to the project rather than hidden in a hosted service.

## Concurrency Model

The old mental model was "one workspace has one live runtime owner." The newer
control-plane model is more precise:

- a local machine should have one live control-plane server;
- many clients can attach to that server;
- workspace-scoped operations resolve their target from request workspace
  identity;
- same-session writes are still protected to avoid concurrent mutation.

Chat safety is centered on the session, not on blocking every second client in
the same workspace.

That means:

- different sessions in the same workspace can be used from different clients;
- terminal chat, browser, mobile, and `ask` can coexist when they use the shared
  control-plane/session path;
- the risky case is multiple live writers touching the same session.

Heddle records a lightweight session lease while a session is being mutated. If
another client tries to continue that same session while the lease is fresh, the
run is blocked with a warning about concurrent mutation risk.

## What `heddle ask` Does

`ask` is a one-shot terminal command. It still exits after one prompt, but the
run is stored as a saved session under `.heddle/` so traces, memory maintenance,
and later inspection use the same persisted conversation path as session-backed
work.

The direction for `ask` is to stay aligned with the shared chat/session model so
one-shot runs and interactive TUI runs do not diverge in session semantics,
approvals, workspace identity, or persistence.

## Management Commands

Not every command needs to be an API client.

Local management commands such as memory, auth, init, heartbeat management, and
eval may call documented core/domain service contracts directly when they are
true adapters:

- parse flags;
- call a public service contract;
- format output.

They should not duplicate core policy, storage semantics, validation, fallback
logic, or workspace resolution in command-specific code.

## Practical Rules

If you want a simple operational checklist:

1. Start `heddle` or `heddle chat` for the default API-backed terminal UI.
2. Start `heddle daemon` when you want the browser control plane or a
   longer-lived local server.
3. Use the browser workspace switcher and `Settings > Workspace` to register,
   rename, and switch local project workspaces.
4. Treat workspace state as local to `.heddle/`, even when several clients are
   attached to the same local control-plane server.
5. Do not assume the web UI, TUI, and daemon are separate runtimes operating
   independently on the same workspace.

## Current Product Boundary

For normal use, the current model should be understood this way:

- `heddle` and `heddle chat` are the default terminal chat experience;
- `heddle daemon` gives you the browser control plane and a stable local server;
- browser and terminal clients use the same control-plane/session path;
- workspace switching chooses which local workspace state a client is operating
  on.

Host-action controls such as takeover or force-embed are intentionally limited
while the workspace-agnostic server model continues to settle.

## Related Guides

- [Chat and sessions](chat-and-sessions.md)
- [Control plane](control-plane.md)
- [Heartbeat](heartbeat.md)
- [CLI reference](../reference/cli.md)
