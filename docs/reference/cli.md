# CLI Reference

This page is a command lookup for the current Heddle CLI surface.

## Main Commands

### Chat and one-shot use

- `heddle` or `heddle chat`: start interactive chat mode in the current workspace
- `heddle ask "<goal>"`: run a single prompt and exit

### Control plane

- `heddle daemon`: start the browser control-plane daemon

### Heartbeat and scheduling

- `heddle heartbeat start [--every 30m] [--task "<durable task>"]`: create or enable the default heartbeat task and run the foreground scheduler
- `heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m]`: create or update a scheduled heartbeat task
- `heddle heartbeat task list`: list local heartbeat tasks
- `heddle heartbeat task show <id>`: show a task's schedule, last decision, and last run summary
- `heddle heartbeat task enable <id>`: enable a heartbeat task
- `heddle heartbeat task disable <id>`: disable a heartbeat task
- `heddle heartbeat run --once`: run due heartbeat tasks once
- `heddle heartbeat run [--poll 60s]`: run the foreground heartbeat scheduler until interrupted
- `heddle heartbeat runs list [--task <id>] [--limit 10]`: list saved heartbeat run records
- `heddle heartbeat runs show <run-id|latest> [--task <id>]`: show the final agent output for a saved heartbeat run

### Project setup

- `heddle init`: create a `heddle.config.json` template in the current project

## Common Flags

These flags show up across multiple commands:

- `--cwd <path>`: run against another workspace path
- `--model <name>`: choose the active model
- `--max-steps <n>`: limit the agent loop length

## Common Usage Examples

Start chat in the current repo:

```bash
heddle
```

Run a one-shot question:

```bash
heddle ask "Summarize the test strategy in this repository"
```

Run against another workspace:

```bash
heddle --cwd /path/to/project
```

Start the control plane:

```bash
heddle daemon
```

After the daemon starts, open the browser control plane to inspect sessions, review diff/command evidence, and use the `Workspaces` section to switch between local projects. For one-off CLI usage against another project, keep using `--cwd`.

Start the foreground heartbeat scheduler:

```bash
heddle heartbeat start --every 30m
```

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
- Workspace state is local to the project under `.heddle/`. The browser control plane can register and switch between local workspaces, but each workspace keeps its own sessions, traces, memory, and tasks.
- Heartbeat scheduler commands are local-first; adding a task does not create a background OS service by itself.

## See Also

- [Chat and sessions guide](../guides/chat-and-sessions.md)
- [Control plane guide](../guides/control-plane.md)
- [Heartbeat guide](../guides/heartbeat.md)
- [Project config](config.md)
