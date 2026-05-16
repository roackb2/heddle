# Runtime Workspaces

Owns the persisted workspace catalog and the semantics around selecting,
creating, and renaming runtime workspaces.

Host surfaces should call `RuntimeWorkspaceService`. File I/O stays behind
`FileWorkspaceRepository`, and the JSON contract lives in `schemas.ts`.
