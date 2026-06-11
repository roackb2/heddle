# CLI Reference

This page is a command lookup for the current Heddle CLI surface.

## Main Commands

### Chat and one-shot use

- `heddle` or `heddle chat`: start interactive chat mode in the current workspace
- `heddle ask "<goal>"`: run a single prompt and exit, backed by a one-off saved session

### Control plane

- `heddle daemon`: start the browser control-plane daemon

### Provider auth

- `heddle auth status`: show stored provider credentials
- `heddle auth login openai`: sign in with an OpenAI ChatGPT/Codex account
- `heddle auth login openai --no-browser`: print the authorization URL without opening a browser
- `heddle auth logout openai`: remove the stored OpenAI credential

OpenAI account sign-in is experimental and user-selected. It is not official OpenAI support, and Heddle is not affiliated with, endorsed by, or sponsored by OpenAI. Anthropic currently uses API-key auth; Heddle does not support Anthropic consumer subscription OAuth.

### Heartbeat and scheduling

- `heddle heartbeat start [--every 30m] [--task "<durable task>"] [--poll 60s] [--once]`: create or update a task and keep the server-backed scheduler running, or run once with `--once`
- `heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m]`: create or update a scheduled heartbeat task
- `heddle heartbeat task list`: list local heartbeat tasks
- `heddle heartbeat task show <id>`: show a task's schedule, last decision, and last run summary
- `heddle heartbeat task enable <id>`: enable a heartbeat task
- `heddle heartbeat task disable <id>`: disable a heartbeat task
- `heddle heartbeat run [--task <id>]`: ask the control-plane server to run due heartbeat tasks, or one task when `--task` is provided
- `heddle heartbeat runs list [--task <id>] [--limit 10]`: list saved heartbeat run records
- `heddle heartbeat runs show <run-id|latest> [--task <id>]`: show the final agent output for a saved heartbeat run

### Project setup

- `heddle init`: create a local `.heddle/config.json` template in the current project

### Evaluation harness

- `heddle eval agent [--cases-dir <path>] [--case <id>] [--output <path>] [--dry-run]`: run JSON-defined agent eval cases
- `heddle eval clean [--results-dir <path>] [--before <datetime>] [--yes]`: prune generated eval result directories

## Common Flags

These flags show up across multiple commands:

- `--cwd <path>`: run against another workspace path
- `--model <name>`: choose the active model
- `--max-steps <n>`: limit the agent loop length
- `--prefer-api-key`: prefer an available provider API key over a stored OAuth credential for that run

## Common Usage Examples

Start chat in the current repo:

```bash
heddle
```

Run a one-shot question:

```bash
heddle ask "Summarize the test strategy in this repository"
```

`ask` still behaves like a one-shot command from the terminal, but Heddle stores the run as a one-off session under `.heddle/` so traces, memory maintenance, and later review use the same persisted conversation path as other session-backed runs.

Run against another workspace:

```bash
heddle --cwd /path/to/project
```

Force OpenAI Platform API-key mode when both OAuth and API-key credentials exist:

```bash
heddle --prefer-api-key chat --model gpt-5.4-mini
heddle --prefer-api-key ask "List the top-level build commands"
heddle --prefer-api-key daemon
```

Use a local Ollama model:

```bash
ollama list
heddle --model ollama/llama3.2:latest ask "Summarize this repository"
```

Ollama models do not require a hosted provider API key. Start Ollama locally,
then select an installed chat model with the `ollama/` prefix.

Start the control plane:

```bash
heddle daemon
```

After the daemon starts, open the browser control plane to inspect sessions, review current Git workspace changes, manage local workspaces, inspect memory status, and use the heartbeat task workbench. The supported browser UI is web-v2. For one-off CLI usage against another project, keep using `--cwd`.

Start the server-backed heartbeat scheduler:

```bash
heddle heartbeat start --every 30m
```

Run due heartbeat tasks once:

```bash
heddle heartbeat run
```

## Interactive Chat Commands

`heddle` and `heddle chat` start the API-backed terminal UI.

Inside `heddle` / `heddle chat`, the most-used local commands are:

- `/model`: show the active model
- `/model set <query>`: filter and choose a model interactively
- `/reasoning`: show configured and effective reasoning effort
- `/reasoning set <query>`: filter and choose reasoning effort interactively
- `/reasoning <low|medium|high>`: set reasoning effort directly for the current session
- `/reasoning default`: clear explicit reasoning effort for the current session
- `/session list`: show recent saved sessions
- `/session choose <query>`: filter and choose a saved session
- `/session new [name]`: create and switch to a new session
- `/session switch <id>`: switch to another saved session
- `/session continue <id>`: switch to a session and resume it immediately
- `/session rename <name>`: rename the current session
- `/session pin`: keep the current session grouped above normal recent sessions
- `/session unpin`: return the current session to normal recent ordering
- `/session close <id>`: remove a saved session
- `/continue`: continue the current session
- `/compact`: compact older session history
- `/skills`: list discovered Agent Skills and activation status for this workspace
- `/skills enable <name>`: enable one Agent Skill for future turns in this workspace
- `/skills disable <name>`: disable one active Agent Skill for future turns in this workspace
- `/browser`: show Browser Automation status for this workspace
- `/browser enable`: enable built-in Browser Automation guidance and browser tools for future default turns in this workspace
- `/browser disable`: disable built-in Browser Automation guidance and browser tools for future default turns in this workspace
- `/browser headed`: run future Browser Automation sessions in a visible browser window
- `/browser headless`: run future Browser Automation sessions without a visible browser window
- `/browser profile <id>`: select the Heddle-owned browser profile future browser runs should use
- `/browser channel <chromium|chrome|msedge>`: select the Playwright browser channel future browser runs and manual profile windows should use
- `/browser open-profile [url]`: open the selected Heddle-owned browser profile in a visible window for manual login or session management
- `/browser close-profile`: close the selected manual browser profile window and release its profile lock

Prompt editing supports `Shift+Enter` for newlines, `Ctrl+Z`/`Ctrl+Y` for undo/redo, and `Up`/`Down` for submitted prompt history when the cursor is on the first or last logical line.

## Development Commands In This Repository

Inside this repository, common development commands include:

```bash
yarn cli:dev
yarn chat:dev
yarn daemon:dev
yarn server:dev
yarn client:dev
yarn build
yarn test
yarn eslint
yarn typecheck
```

## Notes

- The installed command is `heddle`.
- By default, commands operate on the current working directory unless `--cwd` is provided.
- Workspace state is local to the project under `.heddle/`. Saved sessions use `.heddle/chat-sessions.catalog.json` plus per-session files under `.heddle/chat-sessions/`. The browser control plane can register and switch between local workspaces, but each workspace keeps its own sessions, traces, memory, and tasks.
- Heartbeat task state is local-first, but heartbeat command execution is control-plane backed. Task and run commands attach to a live server or start an embedded server so terminal and browser clients use the same heartbeat API and run-record shapes.

## See Also

- [Chat and sessions guide](../guides/chat-and-sessions.md)
- [Agent Skills guide](../guides/agent-skills.md)
- [Control plane guide](../guides/control-plane.md)
- [Heartbeat guide](../guides/heartbeat.md)
- [Project config](config.md)
