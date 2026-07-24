# Coding Files Toolkit

The coding-files toolkit owns structured file inspection and mutation inside
one host-provided workspace root.

## Owns

- File reads, directory listing, and literal search.
- Direct file edits, deletion, and moves.
- Canonical workspace containment through `WorkspacePathPolicy`.
- Tool-level input validation and deterministic result shapes.

## Canonical Containment

Every coding-file operation resolves its workspace root and target through the
filesystem before access:

- Existing targets use their canonical `realpath`.
- New targets use the canonical nearest existing parent plus the missing path
  suffix.
- Move operations validate both the existing source and the destination.
- Approval and Auto policy receive the same canonical targets used by tool
  execution.

This prevents an in-workspace symlink from redirecting a coding-file operation
outside the configured root. The canonical target is the path the operation
uses and the path approval surfaces should display.

Canonical containment is defense in depth. It reduces accidental or
model-directed path escape, but it is not an operating-system sandbox and
cannot eliminate filesystem time-of-check/time-of-use races. Hosts running
untrusted workloads should still use mature OS isolation and least-privilege
filesystem permissions.

## Does Not Own

- Shell command filesystem access. Shell tools have separate policy and should
  run inside host-selected OS isolation when required.
- Human approval UI or remembered approval rules.
- Host authentication and workspace-to-tenant authorization.
- Repository-specific source-control behavior.

## Extension Guidance

New coding-file operations must use `WorkspacePathPolicy` rather than adding
their own lexical `resolve`/`relative` checks. Use `resolveExisting` for reads
and existing mutation sources, and `resolveCreatable` when a target may not yet
exist. If an operation has multiple targets, expose them through
`resolveToolTargets` so Auto policy and approval surfaces see the same
canonical scope as execution.

## Tests

The integration suite in
`src/__tests__/integration/tools/tools.test.ts` covers valid in-root access,
outside symlink targets, nested symlinks, missing create targets, and move
source/destination containment.
