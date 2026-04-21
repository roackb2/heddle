# Runtime Host Model

Heddle is local-first, but it is not purely stateless.

To use Heddle well, it helps to understand one design rule:

> A workspace can have only one live runtime owner at a time.

This guide explains what that means in practice, why Heddle works that way, and how to reason about terminal chat, `ask`, the daemon, and the browser control plane.

## The Short Version

Heddle has two ways to run:

- `embedded` mode: the CLI command you started owns execution directly
- `daemon` mode: a background Heddle daemon owns execution for that workspace

The ownership unit is the workspace, not your whole machine.

That means:

- one repo or project root can run embedded
- another workspace can be daemon-owned at the same time
- but one workspace should not have two live owners mutating state in parallel

## What Counts As A Workspace

A Heddle workspace is the local project scope Heddle is operating on.

In the simplest case, it is just the directory you started Heddle from.

A workspace has:

- an `anchor root`
- a `state root`
- a stable `workspace id`
- optional multiple `repo roots`

By default, Heddle stores workspace-local state under:

```text
<workspace>/.heddle/
```

That includes things like:

- saved chat sessions
- heartbeat tasks and run history
- memory notes
- traces
- workspace metadata

This is intentional. Heddle is designed so the workspace keeps its own operational state rather than hiding it in a hosted service.

## Why Heddle Uses Ownership

Without workspace ownership, two Heddle processes could both believe they are in charge of the same workspace.

That creates bad failure modes:

- two processes editing or checkpointing the same session state
- heartbeat tasks being triggered by multiple hosts
- the browser control plane showing one view while a different embedded process mutates local state behind its back
- no clear answer to which process should handle approvals, recovery, or background work

Heddle avoids that by treating runtime ownership as singular per workspace.

## Embedded Mode

Embedded mode is the zero-setup path.

Examples:

```bash
heddle
heddle chat
heddle ask "summarize this repo"
```

In embedded mode:

- the command you started owns execution
- state is still written under the workspace’s `.heddle/`
- no daemon is required
- this is the normal path for direct terminal use when no daemon already owns that workspace

This is the simplest mental model:

- you run a command
- that command is the runtime host

## Daemon Mode

Daemon mode is the background-owner path.

Example:

```bash
heddle daemon
```

In daemon mode:

- the daemon becomes the runtime owner for that workspace
- the browser control plane reads and mutates daemon-owned runtime state
- this is the right shape for longer-lived background and remote oversight workflows

The daemon is especially useful when you want:

- a browser control plane
- remote access from another device
- one stable owner for sessions and tasks while the workstation keeps running

## The Control Plane Is A Client, Not A Separate Runtime

The browser control plane is not meant to be a second independent host.

Its job is to act as an operator surface for the runtime owner.

When the daemon is running:

- the web UI talks to the daemon
- the daemon is the host that owns the workspace

This is why the browser UI should be understood as a view into the active runtime, not as a different execution model.

## What Happens When A Daemon Already Owns A Workspace

If a live daemon already owns the workspace, Heddle will avoid starting a conflicting embedded owner by default.

Today, that means:

- `heddle chat` is blocked from starting embedded against the same workspace
- mutating `heddle heartbeat ...` commands are blocked
- `heddle session ...` mutation paths are blocked
- starting a second daemon is blocked
- `heddle ask` can attach to the live daemon instead of failing

This is deliberate. Heddle prefers one clear owner over silent split-brain behavior.

## What `heddle ask` Does

`ask` is currently the first CLI path that can attach to a daemon-owned workspace.

That means if a live daemon already owns the workspace:

- a stateless `heddle ask "..."` runs through the daemon
- a session-backed `heddle ask --session ...` or `--new-session ...` also runs through the daemon

So `ask` behaves like a useful one-shot client of the active runtime host.

This is different from `chat`, which still remains an embedded interactive surface today.

## The Daemon Registry

Heddle keeps a small user-level daemon registry so commands can discover active workspace ownership.

Conceptually, that registry tracks:

- known workspaces
- active daemon owner metadata
- endpoint and last-seen timestamps

Its job is coordination and discovery.

It is not the main source of truth for workspace history.

The authoritative operational state still lives with the workspace under `.heddle/`.

## Mental Model For Real Use

When deciding how to run Heddle, use this rule of thumb:

### Use embedded mode when:

- you want direct terminal chat
- you are working locally in one shell
- you do not need the daemon or browser control plane for that workspace

### Use daemon mode when:

- you want the browser control plane
- you want a stable background owner for that workspace
- you want to inspect or operate Heddle from another device

### Do not think of daemon mode as “extra UI”

It is not just a web wrapper around the same terminal process.

It is a different host mode:

- same runtime core
- different live owner

That is the key distinction.

## Why State Lives In The Workspace

Heddle stores state under the workspace on purpose.

That gives you:

- readable local state
- portable project history
- no required hosted backend
- easier debugging and inspection

It also means the runtime host model stays tied to the actual project rather than to a centralized hidden store.

## Current Limitations

The host model is mostly done as a runtime model.

Important current limits:

- `chat` does not yet attach to daemon-owned sessions
- if a daemon already owns the workspace, browser and mobile clients are just clients of that daemon; switching devices is normal and does not require takeover
- browser/mobile do not currently expose host-action controls such as takeover or force-embed, because those actions are not yet useful enough without a stronger ownership policy behind them
- same-session conflict protection is now a soft session lease, not a full takeover system yet

So the correct mental model is:

- one workspace
- one live owner
- many clients can observe and operate through that owner

What remains is mostly around special-case ownership transitions, not the normal desktop/mobile workflow.

## Session Concurrency

Chat safety is now centered on the session, not the whole workspace.

That means:

- different sessions in the same workspace can be used from different clients
- desktop web, mobile web, `ask`, and embedded TUI can coexist
- the risky case is multiple live writers touching the same session

Heddle now records a lightweight session lease while a session is being mutated. If another client tries to continue that same session while the lease is still fresh, the run is blocked with a warning about concurrent mutation risk.

This is intentionally a soft coordination mechanism:

- it prevents the main same-session corruption case
- it does not yet implement rich takeover, transfer, or presence UI

## Practical Rules

If you want a simple operational checklist:

1. Start `heddle` or `heddle chat` when you want direct terminal interaction and no daemon owns that workspace.
2. Start `heddle daemon` when you want the browser control plane or a stable background owner.
3. Treat the workspace as having one live owner at a time.
4. Use `heddle ask` as a lightweight client when a daemon already owns the workspace.
5. Do not assume the web UI, TUI, and daemon are separate runtimes operating independently on the same workspace.

## Current Product Boundary

For normal use, the current host model should be understood this way:

- start `heddle daemon` when you want browser access or multi-device access
- use desktop web, mobile web, and `ask` as clients of that daemon
- do not expect browser/mobile to take over or force embedded mode yet

That means the absence of host-action controls in the browser is intentional for now. The useful path today is one stable daemon owner with multiple clients, not ownership switching from the UI.

## Related Guides

- [Chat and sessions](chat-and-sessions.md)
- [Control plane](control-plane.md)
- [Heartbeat](heartbeat.md)
- [CLI reference](../reference/cli.md)
