# Workspaces

This document defines the workspace contract for the daemon, server control
plane, and web-v2.

## Goal

A workspace is the project root whose `.heddle` directory owns all project
state. The workspace's state root is the source of truth for sessions, memory,
traces, logs, uploads, heartbeat tasks, and any other persisted side effect.

The daemon can serve multiple workspaces, but a workspace-scoped operation must
never infer its target from the daemon process current directory after the
request has reached the server boundary.

## Vocabulary

- **Workspace root**: the project directory shown to the user.
- **Workspace state root**: the `.heddle` directory under the workspace root.
- **Heddle global registry**: the user-level registry under `~/.heddle` that
  records daemon ownership and known workspaces across local state roots.
- **Request workspace**: the workspace selected by one frontend request,
  resolved once from the request `workspaceId`.

`stateRoot` is derived from the workspace root as `<workspaceRoot>/.heddle`.
Avoid reintroducing older root names such as `anchorRoot`.

## Runtime Model

The daemon has a startup workspace for bootstrap, asset serving, registry
ownership, and default fallback behavior. That startup workspace is not the
same thing as the workspace currently visible in web-v2.

Web-v2 carries the selected `workspaceId` in workspace-owned tRPC calls and
upload requests. The server resolves that id to a `RequestWorkspace` once at
the API boundary:

```text
web-v2 selected workspaceId
  -> tRPC workspace middleware or upload service
  -> RequestWorkspace { workspaceRoot, stateRoot, workspaceId, logger }
  -> controller
  -> core service
  -> persisted state under stateRoot
```

Controllers and core services should receive concrete roots. They should not
look at process cwd, daemon cwd, or the active workspace catalog again for a
request that already resolved a request workspace.

## Frontend Rule

Everything visible in web-v2 should be keyed by the selected workspace:

- the session list;
- selected session detail;
- live session event subscription;
- file mention autocomplete;
- diff preview;
- memory settings/status;
- heartbeat tasks and runs;
- image uploads.

When the user switches workspace, the UI may leave runs active in the old
workspace. Late responses from the old workspace must refresh that old
workspace's cache, but must not overwrite the currently viewed workspace or
session state.

## Backend Side Effects

Workspace-scoped control-plane procedures use the request workspace resolved by
`controlPlaneWorkspaceProcedure`. The concrete roots must flow into the domain
owner:

- session catalog and session JSON: `stateRoot/chat-sessions.catalog.json` and
  `stateRoot/chat-sessions/`;
- traces: `stateRoot/traces/`;
- memory: `stateRoot/memory/`;
- uploaded images: `stateRoot/uploads/sessions/<sessionId>/`;
- heartbeat tasks and runs: `stateRoot/heartbeat/`;
- diff and file search: `workspaceRoot`;
- operation logs: `stateRoot/logs/server.log`.

The daemon may still write process lifecycle and transport-level logs to the
startup state root. Workspace operations should additionally write to the
request workspace log so debugging evidence follows the same state root as the
session, trace, and memory artifacts.

Workspace loggers are cached per resolved workspace state root. Workspace-owned
controllers should use the logger on the resolved request workspace instead of
the daemon startup logger.

## Extension Rules

When adding a new web-v2 feature that reads or mutates workspace-owned data:

1. Carry `workspaceId` from the selected route or shell state into the API call.
2. Use the workspace-scoped tRPC procedure unless the operation is genuinely
   global, such as browsing local directories or creating a workspace.
3. Resolve the workspace once at the server boundary.
4. Pass `workspaceRoot`, `stateRoot`, and `workspaceId` downstream as concrete
   values.
5. Include `workspaceId` in React Query inputs and invalidate the specific
   workspace cache after mutations.
6. Add a regression test proving the operation uses the requested workspace
   without switching the daemon active workspace.

Do not add compatibility shims that silently fall back to the daemon workspace
for workspace-owned data. If a temporary compatibility path is unavoidable,
mark it with an inline comment so it is easy to remove before v2 release.
