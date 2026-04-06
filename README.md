# Heddle

Heddle is a terminal coding agent runtime and CLI built mainly for interactive chat inside a real project directory, with tool calls, command approval, traces, and persistent chat state.

It is built for repository work such as:

- understanding an unfamiliar codebase
- searching, reading, and editing files
- running shell commands with explicit approval for risky actions
- keeping a trace of what the agent did in `.heddle/`

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

## Current Functionality

The current runtime exposes a small set of repo-oriented capabilities:

- list files
- read files
- search files
- search the public web through a host-side `web_search` tool
- edit files
- run shell commands in inspect or approval-gated mutate mode
- report state
- update a plan during a run

Operator-facing behavior includes:

- explicit approval flow for risky tool calls and mutate commands
- project-level remembered command approvals
- per-project state under `.heddle/`
- saved chat sessions and resumable chat workflow
- trace logs for runs and tool activity
- project instruction injection from `AGENTS.md` by default

Chat usage notes:

- use `/continue` for built-in resume behavior
- use `/model`, `/model list`, or `/model set` to inspect or switch models in chat
- use `/session` commands to create, switch, continue, rename, and close saved sessions
- use `!<command>` to run shell commands directly from the composer
- during approval, `A` remembers the current mutate command for the project, while `Y` approves once and `N` denies
- if a long-running turn appears stuck, `Esc` requests an interrupt

Current roadmap note:

- web search is now landing as a normal host-side tool backed by hosted provider search
- image support is planned to start with local path references plus a host-side `view_image` tool before any full multimodal attachment redesign

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

## Who It Is For

Heddle is for people who want a coding agent that runs in a real repository with visible traces and explicit host-side control.

It is a good fit if you want:

- a CLI-first coding assistant
- a minimal runtime you can inspect and extend
- direct workspace execution instead of a hosted IDE product

It is not trying to be:

- a no-code agent builder
- a multi-agent orchestration framework
- a general prompt workflow library

## Runtime And Library

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

Heddle's long-term goal is broader than the current CLI: a credible general runtime for tool-using agents. The current implementation stays deliberately narrow and behavior-first so abstractions only get added after real runtime traces justify them.

More project context:

- [Framework Vision](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/framework-vision.md)
- [Project Purpose](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/project-purpose.md)
- [Coding Agent Roadmap](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/coding-agent-roadmap.md)
- [Web Search And Image Viewing](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/docs/web-search-and-image-viewing.md)

## License

MIT
