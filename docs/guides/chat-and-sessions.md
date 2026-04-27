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

## Typical Chat Workflow

Common use cases:

- explain architecture, tests, or build setup
- iterate on a fix over multiple prompts
- inspect files, search the repo, and edit code inside one persistent session
- keep longer work usable through saved sessions, `/continue`, automatic history compaction, and manual `/compact`
- let the agent create and update a short working plan for a multi-step implementation
- search official docs or current external references with provider-backed `web_search`
- mention important repo files with `@path/to/file`
- reference a local screenshot path and have the agent inspect it with `view_image`
- run direct shell commands from chat with `!<command>`

## Session Management

Useful chat commands:

- `/help`: show local chat commands
- `/continue`: resume the current session from its last interrupted or prior run
- `/model`: show the active model
- `/model list`: show the built-in shortlist
- `/model set <query>`: open the interactive model picker
- `/model <name>`: switch models directly
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

## Direct Shell In Chat

```bash
!pwd
!git status
!yarn test
```

Read-oriented commands stay in inspect mode when possible. Workspace-changing or unclassified commands fall back to approval-gated execution.

## State And Continuity

Chat state is stored under `.heddle/`, including saved sessions, traces, approvals, and memory notes. The footer context indicator is an estimate of total request input against the active model's context window, not only raw chat history length.

For local development against the sibling CyberLoop repo, run chat with the middleware module path:

```bash
HEDDLE_CYBERLOOP_ADVANCED_MODULE=/Users/roackb2/Studio/projects/CyberLoop/src/advanced/kinematics-middleware.ts yarn chat:dev:openai
```

Drift telemetry is disabled by default for new sessions. For installed usage, install the optional `cyberloop` peer dependency in the same environment as Heddle so it can dynamically import `cyberloop/advanced`, then enable it with `/drift on` when you intend to use OpenAI Platform API-key mode for drift embeddings.

## See Also

- [CLI reference](../reference/cli.md)
- [Capabilities and tools](../reference/capabilities.md)
- [Semantic drift](semantic-drift.md)
- [Knowledge persistence](knowledge-persistence.md)
