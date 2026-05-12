# Coding Awareness

The coding awareness domain owns the first-call situation-awareness package for repository work.

## Responsibility

- Provide the default coding `project_dashboard` snapshot for the active workspace.
- Gather fresh current-state orientation without forcing the agent to choose between multiple startup tools.
- Keep the snapshot bounded, source-attributed, and explicit about limits.

## Gathered Information

Current `project_dashboard` output includes:

- `working_environment`
  - workspace root
  - git repository root
  - branch
  - short commit
  - dirty state
  - grouped changed paths
- `workspace_tree`
  - bounded directory/file tree for quick structural orientation
  - configurable depth and entry budget
  - omission/truncation surfaced through `limits`

## Boundaries

- This domain provides initial orientation, not proof of implementation behavior.
- Durable preferences, workflow conventions, and historical context belong to memory, not coding awareness.
- Deeper code or documentation claims still require `read_file`, `search_files`, tests, or command results.

## Agent-Facing Tool UX

- Agent-facing default tool: `project_dashboard`
- Default behavior: return all core coding-awareness sections in one call
- Optional input: narrow included sections or tune tree bounds

Example tool result shape:

```json
{
  "ok": true,
  "output": {
    "schemaVersion": 1,
    "domain": "coding",
    "profile": "project_dashboard",
    "collectedAt": "2026-05-12T12:09:54.224Z",
    "workspaceRoot": "/workspace/heddle",
    "sections": {
      "working_environment": {
        "workspaceRoot": "/workspace/heddle",
        "gitRepositoryRoot": "/workspace/heddle",
        "gitBranch": "codex/situation-awareness-working-environment",
        "gitShortCommit": "98da2c2",
        "isGitRepository": true,
        "isDirty": false,
        "paths": {
          "staged": [],
          "modified": [],
          "deleted": [],
          "untracked": [],
          "renamed": []
        }
      },
      "workspace_tree": {
        "root": "/workspace/heddle",
        "maxDepth": 2,
        "maxEntries": 60,
        "entries": [
          {
            "path": "docs",
            "kind": "directory",
            "children": [
              { "path": "docs/agent-context.md", "kind": "file" },
              { "path": "docs/project-posture.md", "kind": "file" }
            ]
          },
          {
            "path": "src",
            "kind": "directory",
            "children": [
              { "path": "src/core", "kind": "directory", "truncated": true },
              { "path": "src/index.ts", "kind": "file" }
            ]
          },
          { "path": "README.md", "kind": "file" }
        ]
      }
    },
    "sources": [
      { "kind": "filesystem", "path": "/workspace/heddle", "note": "workspace root" },
      { "kind": "git", "command": "git rev-parse --show-toplevel" }
    ],
    "limits": [
      {
        "kind": "truncated",
        "subject": "workspace tree depth",
        "detail": "Stopped descending into 3 directories at depth 2."
      }
    ]
  }
}
```
