# Heddle

Heddle is a terminal coding agent runtime and CLI.

It is open source, provider-agnostic, and currently supports OpenAI and Anthropic models.

## How Heddle Helps

- daily development work in real coding projects
- understanding unfamiliar repositories and carrying fixes through inspection, edits, and verification
- infrastructure and environment inspection through approval-gated shell commands
- broader terminal-based agent workflows whenever the needed CLI tools already exist in the environment
- tasks such as image, media, or document processing through existing command-line tools like `ffmpeg`, ImageMagick, or project-specific scripts
- long-running multi-step work that benefits from chat continuity, short plans, and explicit operator control

## Advanced Capabilities

- provider-agnostic model support across OpenAI and Anthropic
- hosted web search through `web_search`
- local image viewing from referenced file paths through `view_image`
- inline `@file` mentions that tell the agent which workspace files to inspect first
- multi-turn sessions with save, switch, continue, rename, and close flows
- automatic conversation compaction for longer chats
- lightweight working-plan tracking through `update_plan`
- approval-gated shell execution with remembered per-project approvals
- trace logs, persistent chat state, and project instruction loading under `.heddle/`

## Install

Global install:

```bash
npm install -g @roackb2/heddle
```

Run without a global install:

```bash
npx @roackb2/heddle
```

The installed CLI command remains `heddle`.

## Quick Start

1. Set an API key for a supported provider.

```bash
export OPENAI_API_KEY=your_key_here
# or
export ANTHROPIC_API_KEY=your_key_here
```

2. Move into the project you want Heddle to work on.

```bash
cd /path/to/project
```

3. Start chat mode.

```bash
heddle
```

Heddle uses the current directory as the workspace root unless you pass `--cwd`.

The default workflow is interactive chat, not one-shot prompts. You keep a session open, inspect the repo, switch models, run direct shell commands when needed, and continue earlier sessions later.

## Core Capabilities

Heddle currently supports:

- repository inspection with `list_files`, `read_file`, and `search_files`
- code and doc changes with `edit_file`
- hosted web search through `web_search`
- local screenshot and image inspection through `view_image`
- inline `@file` mentions for file-priority context without pasting file contents into the prompt
- shell execution with inspect vs approval-gated mutate behavior
- multi-turn chat sessions with saved history under `.heddle/`
- session management with create, switch, continue, rename, and close flows
- automatic conversation compaction so longer chats preserve context instead of growing unbounded
- short working-plan support through `update_plan` for substantial multi-step tasks
- remembered per-project approvals for repeated commands and edits
- interrupt and resume support for longer-running coding workflows

The image workflow is intentionally simple for now: users can reference a local image path in chat, and the agent can decide whether to inspect it with `view_image`. Heddle does not require a full multimodal attachment model for this first version.

The file-mention workflow is also intentionally lightweight: `@path/to/file` tells Heddle that the file is important context and should be inspected before answering, but it does not automatically inline the file contents into the prompt.

The planning workflow is also intentionally lightweight: Heddle does not force a heavyweight planner or a separate "plan mode," but it can automatically record and update a short plan when a task is substantial enough to benefit from visible progress tracking.

## What Heddle Does

Heddle runs an agent loop against your workspace:

```text
goal
  -> send transcript + tool definitions to the model
  -> model answers or requests tool calls
  -> execute tools in the workspace
  -> append results to the transcript
  -> continue until done / max steps / error
```

Current focus:

- chat-first coding and repository workflows from the terminal
- minimal runtime behavior instead of a large framework surface
- traceability and operator control over hidden orchestration

## Chat Workflow

Start chat in the current repo:

```bash
heddle
heddle chat
heddle --cwd /path/to/project
heddle chat --model gpt-5.4-mini --max-steps 20
```

Typical chat use cases:

- ask Heddle to explain architecture, code paths, tests, or build setup
- iterate on a fix over multiple prompts instead of fitting everything into one request
- inspect files, search the repo, and edit code inside one persistent session
- keep a long coding conversation usable through saved sessions, `/continue`, and automatic history compaction
- let the agent create and update a short working plan for a multi-step implementation
- search official docs or other current external references with `web_search`
- mention important repo files with `@path/to/file` so the agent treats them as first-pass context
- reference a local screenshot path and have the agent inspect it with `view_image`
- run direct shell commands from chat with `!<command>`
- pause and later resume earlier sessions

Useful chat commands:

- `/help`: show local chat commands
- `/continue`: resume the current session from its last interrupted or prior run
- `/model`: show the active model
- `/model list`: show the built-in shortlist
- `/model set <query>`: open the interactive model picker
- `/model <name>`: switch models directly
- `/session list`: list recent saved sessions
- `/session choose <query>`: choose a recent session interactively
- `/session new [name]`: create a new session
- `/session switch <id>`: switch to another session
- `/session continue <id>`: switch and immediately continue that session
- `/session rename <name>`: rename the current session
- `/session close <id>`: remove a saved session
- `/clear`: clear the current transcript
- `!<command>`: run a shell command directly in chat

Direct shell in chat:

```bash
!pwd
!git status
!yarn test
```

Read-oriented commands stay in inspect mode when possible. Workspace-changing or unclassified commands fall back to approval-gated execution.

## CLI Usage

Supported commands:

- `heddle` or `heddle chat`: start interactive chat mode
- `heddle ask "<goal>"`: run a single prompt and exit
- `heddle init`: create a `heddle.config.json` template in the current project

Common flags:

- `--cwd <path>`: run against another workspace root
- `--model <name>`: choose the active model
- `--max-steps <n>`: limit the agent loop length

## Supported Providers And Models

Heddle currently has working adapters for:

- OpenAI
- Anthropic

Environment variables:

- `OPENAI_API_KEY` for OpenAI models
- `ANTHROPIC_API_KEY` for Anthropic models
- dev fallback env vars are also accepted: `PERSONAL_OPENAI_API_KEY` and `PERSONAL_ANTHROPIC_API_KEY`

Default models:

- OpenAI: `gpt-5.1-codex`
- Anthropic: `claude-sonnet-4-6`

Built-in model shortlist exposed by the CLI UI:

- OpenAI: `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, `gpt-5.4-nano`
- OpenAI: `gpt-5`, `gpt-5-pro`, `gpt-5-mini`, `gpt-5-nano`
- OpenAI: `gpt-5.2`, `gpt-5.2-pro`, `gpt-5.1`
- OpenAI: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- OpenAI: `o3-pro`, `o3`, `o3-mini`, `o4-mini`
- OpenAI coding models: `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`
- Anthropic: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- Anthropic: `claude-opus-4-1`, `claude-opus-4-0`, `claude-sonnet-4-0`
- Anthropic: `claude-3-7-sonnet-latest`
- Anthropic: `claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest`

Notes:

- model selection is inferred from the model name prefix
- Gemini model names are recognized by provider inference, but a Google adapter is not wired yet
- you can pass another model name with `--model`, but it only works if the corresponding provider adapter supports it

## Project Config

You can store project defaults in `heddle.config.json`:

```json
{
  "model": "gpt-5.1-codex",
  "maxSteps": 40,
  "stateDir": ".heddle",
  "directShellApproval": "never",
  "searchIgnoreDirs": [".git", "dist", "node_modules", ".heddle"],
  "agentContextPaths": ["AGENTS.md"]
}
```

Precedence order:

- CLI flags override `heddle.config.json`
- `heddle.config.json` overrides environment-driven defaults

Field notes:

- `stateDir`: where traces, logs, approvals, and chat state are stored
- `directShellApproval`: whether explicit `!command` input in chat still asks for approval
- `searchIgnoreDirs`: directories excluded from `search_files`
- `agentContextPaths`: project instruction files injected into the system prompt

## Programmatic Use

The npm package also exports the core runtime pieces for programmatic use, including:

- `runAgent`
- LLM adapter helpers
- built-in tools
- trace utilities

Install as a dependency with:

```bash
npm install @roackb2/heddle
```

The public API lives in [src/index.ts](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/src/index.ts).

## Design Direction

Heddle is currently optimized for coding and terminal workflows, but the long-term goal is broader: an open, provider-agnostic runtime for tool-using agents in real working environments.

The current CLI is the proving ground, not the endpoint. The coding-agent workflow matters because it is a demanding, evidence-heavy environment with real files, shell tools, long-running context, and operator oversight. If the runtime holds up there, it can later support wider agentic workflows beyond software projects.

The design direction stays intentionally behavior-first:

- start from real agent loops, traces, approvals, and recovery behavior
- keep the current surface small until abstractions are justified by actual usage
- stay usable as a coding agent while growing toward a more general agent runtime
- support richer workspace tasks, not just code editing, whenever the environment already provides the right tools

More project context:

- [Framework Vision](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/framework-vision.md)
- [Project Purpose](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/project-purpose.md)
- [Coding Agent Roadmap](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/coding-agent-roadmap.md)

## License

MIT
