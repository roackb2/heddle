# Chat And Sessions

Use Heddle chat when you want an interactive coding-agent workflow inside a real project.

## Quick Start

Configure provider access.

For OpenAI, you can sign in with your own ChatGPT/Codex account:

```bash
heddle auth login openai
```

Or use a Platform API key:

```bash
export OPENAI_API_KEY=your_key_here
```

For Anthropic, use an API key:

```bash
export ANTHROPIC_API_KEY=your_key_here
```

OpenAI account sign-in is experimental and optional. It is not official OpenAI support, and Heddle is not affiliated with, endorsed by, or sponsored by OpenAI.

Move into the project you want Heddle to work on:

```bash
cd /path/to/project
```

Start chat:

```bash
heddle
heddle chat
heddle --cwd /path/to/project
heddle chat --model gpt-5.4-mini --max-steps 20
```

Heddle uses the current directory as the workspace root unless you pass `--cwd`.

At startup, Heddle also looks for one project instruction file. The default priority is `HEDDLE.md`, then `AGENTS.md`, then `CLAUDE.md`; the first non-empty file is appended to the system prompt. Set `agentContextPaths` in `heddle.config.json` only when a project needs custom paths or multiple instruction files.

If you keep both OpenAI OAuth and an API key configured, Heddle prefers OAuth by default. For explicit API-key testing, start a run with:

```bash
heddle --prefer-api-key chat --model gpt-5.4-mini
heddle --prefer-api-key ask "Reply with OK"
```

OpenAI account sign-in now supports `view_image` through the Codex OAuth transport. OpenAI hosted `web_search` and drift embeddings still require Platform API-key mode.

## Typical Chat Workflow

Common use cases:

- explain architecture, tests, or build setup
- iterate on a fix over multiple prompts
- inspect files, search the repo with ignore-aware fallback behavior, and edit code inside one persistent session
- watch streamed `Thinking:` progress, tool activity, and current plan updates while long turns are running
- keep longer work usable through saved sessions, `/continue`, automatic history compaction, and manual `/compact`
- let the agent create and update a short working plan for a multi-step implementation
- search official docs or current external references with provider-backed `web_search`
- mention important repo files with `@path/to/file`
- reference a local screenshot path and have the agent inspect it with `view_image`
- attach images from the browser composer, which stores uploads as local workspace paths for `view_image`
- clean up or rename workspace files directly with `delete_file` and `move_file`
- run direct shell commands from chat with `!<command>`

## Session Management

Useful chat commands:

- `/help`: show local chat commands
- `/continue`: resume the current session from its last interrupted or prior run
- `/model`: show the active model
- `/model list`: show the built-in shortlist
- `/model set <query>`: open the interactive model picker
- `/model <name>`: switch models directly
- `/reasoning`: show configured and effective reasoning effort for the current session
- `/reasoning set <query>`: open the interactive reasoning-effort picker
- `/reasoning <low|medium|high>`: set reasoning effort directly
- `/reasoning default`: clear explicit reasoning effort and use the model default
- `/auth`: show stored provider credentials
- `/auth status`: show stored provider credentials
- `/auth login openai`: sign in with OpenAI account auth
- `/auth logout openai`: remove the stored OpenAI credential
- `/session list`: list recent saved sessions
- `/session choose <query>`: choose a recent session interactively
- `/session new [name]`: create a new session
- `/session switch <id>`: switch to another session
- `/session continue <id>`: switch and immediately continue that session
- `/session rename <name>`: rename the current session
- `/session close <id>`: remove a saved session
- `/clear`: clear the current transcript
- `/compact`: compact older session history immediately
- `/drift`: show CyberLoop semantic drift detection status
- `/drift on`: re-enable observe-only CyberLoop telemetry for chat runs
- `/drift off`: disable CyberLoop semantic drift detection
- `!<command>`: run a shell command directly in chat

Prompt editing shortcuts:

- `Shift+Enter`: insert a newline without sending
- `Ctrl+Z`: undo the last prompt edit
- `Ctrl+Y`: redo a prompt edit
- `Up` / `Down`: move through submitted prompt history when the cursor is on the first or last logical line
- `Ctrl+A` / `Ctrl+E`: move to the start or end of the prompt
- `Ctrl+W`: delete the previous word
- `Ctrl+U` / `Ctrl+K`: delete before or after the cursor

## Direct Shell In Chat

```bash
!pwd
!git status
!yarn test
```

Read-oriented commands stay in inspect mode when possible. Workspace-changing or unclassified commands fall back to approval-gated execution.

Approval prompts show the command or search query being requested, and remembered project approvals can cover repeated safe commands without hiding the original action from review.

## State And Continuity

Chat state is stored under `.heddle/`, including saved sessions, traces, approvals, and memory notes. Saved sessions use `.heddle/chat-sessions.catalog.json` plus per-session files under `.heddle/chat-sessions/`; older flat `chat-sessions.json` files are not read by current versions. The footer context indicator is an estimate of total request input against the active model's context window, not only raw chat history length.

The footer also shows the active model, effective reasoning effort, and auth source for the selected model, so you can tell whether the session is using OpenAI account sign-in or API-key mode.

Reasoning effort is persisted with the saved session. When you switch sessions, Heddle restores that session's configured effort instead of treating it as a global terminal setting.

For local development against the sibling CyberLoop repo, run chat with the middleware module path:

```bash
HEDDLE_CYBERLOOP_ADVANCED_MODULE=<path-to-cyberloop>/src/advanced/kinematics-middleware.ts yarn chat:dev:openai
```

Drift telemetry is disabled by default for new sessions. For installed usage, install the optional `cyberloop` peer dependency in the same environment as Heddle so it can dynamically import `cyberloop/advanced`, then enable it with `/drift on` when you intend to use OpenAI Platform API-key mode for drift embeddings.

## See Also

- [CLI reference](../reference/cli.md)
- [Capabilities and tools](../reference/capabilities.md)
- [Semantic drift](semantic-drift.md)
- [Knowledge persistence](knowledge-persistence.md)
