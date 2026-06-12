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
- enabling standard Agent Skills for workspace-approved reusable instructions
- connecting to user-configured MCP integrations for ecosystem tools
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
- API-backed terminal chat through the same control-plane session path as the browser UI
- session management with create, switch, continue, rename, pin, unpin, archive, and close flows
- automatic conversation compaction for longer chats
- manual `/compact` support when an operator wants to shrink session history immediately
- inline `@file` mentions so important files are inspected first
- direct shell commands in chat with `!<command>`
- short visible work plans through `update_plan` for substantial multi-step tasks
- automatic durable memory candidate recording and maintainer-backed catalog updates under `.heddle/memory/`
- read-only memory visibility through `heddle memory status/list/read/search`
- memory validation through `heddle memory validate`
- Agent Skills discovery from `.agents/skills/<name>/SKILL.md` and `~/.agents/skills/<name>/SKILL.md`
- workspace-level skill activation through `/skills`, `/skills enable <name>`, and `/skills disable <name>`
- progressive skill disclosure through the `read_agent_skill` tool for active skills only
- built-in Browser Automation guidance through `/browser`, `/browser enable`, `/browser disable`, `/browser headed`, `/browser headless`, `/browser profile <id>`, `/browser channel <chromium|chrome|msedge>`, `/browser open-profile [url]`, `/browser close-profile`, and Settings -> Browser Automation
- MCP server config and management through `/mcp`, `/mcp config`, `/mcp enable <server>`, `/mcp disable <server>`, and `/mcp refresh <server>`
- cached MCP tool access through `mcp_list_tools`, `mcp_call_tool`, and namespaced tools such as `mcp__server__tool`
- remembered per-project approvals for repeated commands and edits, with clearer previews before approval
- interrupt and resume support for longer-running workflows
- serializable checkpoints for programmatic continuation
- request-size aware context tracking in chat

## Control Plane And Oversight

Beyond terminal chat, Heddle includes:

- a local browser control plane via `heddle daemon`
- browser-side session actions for new session, pin/unpin, inline rename, archive with toast undo, send, continue, cancel, and pending approval resolution
- live per-session updates for assistant streaming, tool progress, approval waits, and saved-session refreshes
- open-client notifications for pending approvals, session run completion, and heartbeat task run completion
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
- Agent Skills are instructions, not permissions. Enabling a skill does not bypass Heddle's approval policy, tool safety checks, browser policy, or workspace permissions.
- Browser Automation is off by default. Enabling it activates Heddle's built-in browser guidance and adds browser tools to future default turns. Browser profiles and policy still remain authoritative; Settings -> Browser Automation and `/browser profile <id>` select a Heddle-owned profile under `.heddle/browser-profiles/`, `/browser channel <chromium|chrome|msedge>` selects the Playwright browser channel, and `/browser open-profile [url]` opens that selected profile in a visible Playwright window for manual login or session management. Close the manual window before asking an agent to use the same profile. Without an explicit domain allowlist, the first opened URL establishes the same-domain browsing boundary.
- MCP server declarations are integrations, not trust grants. Local stdio servers run commands with the user's OS permissions, and MCP tool calls still go through Heddle approvals and traces.
- The control plane review view is read-only. Current changes are Git-backed, while historical turn evidence is trace-backed; it is not yet an editable IDE-grade diff surface or live file watcher.
- The image workflow is intentionally lightweight: terminal users can provide a local image path, and browser uploads are saved back to local workspace state as readable image paths. In both cases, Heddle decides whether inspection is needed through `view_image`.
- OpenAI account sign-in can now drive `view_image` through the Codex OAuth transport. Hosted `web_search` and drift embeddings still require OpenAI Platform API-key mode today.
- `@path/to/file` mentions prioritize file inspection; they do not blindly paste file contents into the prompt.
- Web search is provider-backed rather than a general crawler maintained inside this repository.
- `search_files` honors project ignore files when possible; `.git` and `.heddle` stay protected from broad accidental searches unless explicitly targeted.

## See Also

- [Chat and sessions](../guides/chat-and-sessions.md)
- [Agent Skills](../guides/agent-skills.md)
- [MCP integrations](mcp.md)
- [Programmatic use](../guides/programmatic-use.md)
- [Control plane](../guides/control-plane.md)
