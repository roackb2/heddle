# Runtime Workspaces

Owns the persisted workspace catalog and the semantics around selecting,
creating, and renaming runtime workspaces.

Host surfaces should call `RuntimeWorkspaceService`. File I/O stays behind
`FileWorkspaceRepository`, and the JSON contract lives in `schemas.ts`.

`resolveContext()` follows the catalog's persisted active workspace for hosts
that own workspace selection, such as the browser control plane.
`resolveContextForRoot()` is the non-mutating command-host path: it selects the
descriptor whose workspace and state roots match the command invocation. This
keeps a terminal launched inside one repository from inheriting an unrelated
workspace that was last selected in another host.
