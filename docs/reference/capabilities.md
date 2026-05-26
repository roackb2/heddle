# Capabilities And Tools

This page summarizes what Heddle can currently do from an operator's point of view.

## Core Outcomes

Heddle is built to help with real workspace tasks such as:

- inspecting repositories and explaining unfamiliar codebases
- editing code and docs inside the active workspace
- verifying changes with tests, builds, and repo review evidence
- carrying work across multi-turn sessions instead of treating every prompt as stateless
- switching between local project workspaces through the browser control plane
- learning durable workspace knowledge from normal usage through catalog-backed memory
- exposing local browser oversight through the control plane
- supporting bounded autonomous work through heartbeat scheduling

## Workspace Tools

Current workspace-facing tool support includes:

- directory inspection with `list_files`
- file reading with `read_file`
- text search with `search_files`, using `rg` when available and an ignore-aware `grep` fallback otherwise
- direct file editing with `edit_file`
- direct file deletion with `delete_file`
- direct file/directory move or rename with `move_file`
- read-oriented shell inspection with `run_shell_inspect`
- approval-gated shell mutation with `run_shell_mutate`

## External And Richer Context Tools

Heddle can also use:

- provider-backed hosted web search through `web_search`
- local image inspection through `view_image`

## Runtime Features

Current runtime features include:

- multi-turn chat sessions with saved history under `.heddle/`
- session management with create, switch, continue, rename, and close flows
- automatic conversation compaction for longer chats
- manual `/compact` support when an operator wants to shrink session history immediately
- inline `@file` mentions so important files are inspected first
- direct shell commands in chat with `!<command>`
- short visible work plans through `update_plan` for substantial multi-step tasks
- automatic durable memory candidate recording and maintainer-backed catalog updates under `.heddle/memory/`
- read-only memory visibility through `heddle memory status/list/read/search`
- memory validation through `heddle memory validate`
- remembered per-project approvals for repeated commands and edits, with clearer previews before approval
- interrupt and resume support for longer-running workflows
- serializable checkpoints for programmatic continuation
- request-size aware context tracking in chat

## Control Plane And Oversight

Beyond terminal chat, Heddle includes:

- a local browser control plane via `heddle daemon`
- live per-session updates for assistant streaming, tool progress, approval waits, and saved-session refreshes
- workspace management for registering, renaming, choosing, and switching local project workspaces
- Git-backed current workspace review with changed files and selected-file patches
- trace-backed historical turn review for captured file diffs
- separate evidence tabs for commands, verification, approvals, and trace events
- heartbeat task and run visibility
- workspace memory health visibility
- browser-side model selection and drift toggling
- file mention suggestions in the browser composer
- browser image attachment uploads, stored as local workspace paths for `view_image`
- heartbeat task create, edit, delete, run-now, resume, continuation-mode, and saved-run review controls
- memory status visibility in settings

## Notes And Limits

- Heddle is a coding/workspace agent runtime, not a general-purpose autonomous system.
- Knowledge persistence uses explicit local catalogs and maintainer runs, so users can audit what Heddle learned instead of relying on opaque retrieval.
- The control plane review view is read-only. Current changes are Git-backed, while historical turn evidence is trace-backed; it is not yet an editable IDE-grade diff surface or live file watcher.
- The image workflow is intentionally lightweight: terminal users can provide a local image path, and browser uploads are saved back to local workspace state as readable image paths. In both cases, Heddle decides whether inspection is needed through `view_image`.
- OpenAI account sign-in can now drive `view_image` through the Codex OAuth transport. Hosted `web_search` and drift embeddings still require OpenAI Platform API-key mode today.
- `@path/to/file` mentions prioritize file inspection; they do not blindly paste file contents into the prompt.
- Web search is provider-backed rather than a general crawler maintained inside this repository.
- `search_files` honors project ignore files when possible; `.git` and `.heddle` stay protected from broad accidental searches unless explicitly targeted.

## See Also

- [Chat and sessions](../guides/chat-and-sessions.md)
- [Programmatic use](../guides/programmatic-use.md)
- [Control plane](../guides/control-plane.md)
