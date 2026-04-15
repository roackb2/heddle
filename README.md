# Heddle

Heddle is a terminal coding agent runtime and CLI with semantic drift detection.

It is built to feel like a terminal partner that understands your project, keeps continuity across real work, and becomes more useful over time.

It is open source, provider-agnostic, supports OpenAI and Anthropic models, and can build memory across sessions. For agentic-system builders, Heddle also exposes heartbeat primitives for autonomous wake cycles, checkpointing, and long-running background work.

Heddle is designed to make live agent runs more observable, not just easier to launch. With CyberLoop installed, Heddle can show whether the agent's outputs are moving away from the recent response trajectory, surface `drift=unknown|low|medium|high` in chat, and write drift annotations into saved traces instead of leaving you to infer that only from token usage and tool calls.

If you are interested in the underlying methodology, Heddle's drift telemetry is powered by [CyberLoop on npm](https://www.npmjs.com/package/cyberloop). See the [CyberLoop repository](https://github.com/roackb2/cyberloop) and [paper](https://zenodo.org/records/18138161) for the geometric-control and trajectory-based details.

## Agenda

- [Chat And CLI Usage](#chat-and-cli-usage)
- [Control Plane](#control-plane)
- [Knowledge Persistence](#knowledge-persistence)
- [Semantic Drift](#semantic-drift)
- [Heartbeat](#heartbeat)
- [Programmatic Use](#programmatic-use)
- [Capability Details](#capability-details)
- [Supported Providers And Models](#supported-providers-and-models)
- [Project Config](#project-config)
- [Design Direction](#design-direction)

## How Heddle Helps

- daily development work in real coding projects
- understanding unfamiliar repositories and carrying fixes through inspection, edits, and verification
- infrastructure and environment inspection through approval-gated shell commands
- broader terminal-based agent workflows whenever the needed CLI tools already exist in the environment
- tasks such as image, media, or document processing through existing command-line tools like `ffmpeg`, ImageMagick, or project-specific scripts
- long-running multi-step work that benefits from chat continuity, short plans, and explicit operator control

## Advanced Capabilities

- provider-agnostic model support across OpenAI and Anthropic
- embeddable `runAgentLoop` API for building non-CLI agent hosts
- `runAgentHeartbeat` for scheduler-driven autonomous wake cycles without chat by default
- native React/Vite control plane served by `heddle daemon` for local browser-based oversight
- serializable checkpoints for resume, background execution, and hosted workers
- host-facing heartbeat task/run views plus websocket-friendly status/progress/response adapters
- provider-backed hosted web search through `web_search`
- local image viewing from referenced file paths through `view_image`
- inline `@file` mentions that tell the agent which workspace files to inspect first
- multi-turn sessions with save, switch, continue, rename, and close flows
- automatic conversation compaction for longer chats, plus manual `/compact` when needed
- persistent workspace knowledge through `.heddle/memory/`
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

If you want CyberLoop drift telemetry in chat, or you want to import `cyberloop/advanced` in your own host, install `cyberloop` in the same environment as Heddle:

```bash
npm install -g cyberloop
# or for project-local usage
npm install cyberloop
```

The plain `npx @roackb2/heddle` path does not include optional peer dependencies. For one-off drift-enabled usage, install both packages locally or run:

```bash
npx -p @roackb2/heddle -p cyberloop heddle
```

If you are developing inside the Heddle repo itself, `yarn install` also installs `cyberloop` through `devDependencies`, so `yarn chat:dev` can use the published package path without extra setup.

For local development against the full CLI entrypoint, use `yarn cli:dev`. The `chat:dev` scripts intentionally start chat mode directly and do not route subcommands such as `heartbeat`.

## Chat And CLI Usage

### Quick Start

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

### Chat Workflow

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
- keep a long coding conversation usable through saved sessions, `/continue`, automatic history compaction, and manual `/compact`
- let the agent create and update a short working plan for a multi-step implementation
- search official docs or other current external references with provider-backed `web_search`
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
- `/compact`: compact older session history immediately
- `/drift`: show CyberLoop semantic drift detection status
- `/drift on`: re-enable observe-only CyberLoop kinematics telemetry for chat runs
- `/drift off`: disable CyberLoop semantic drift detection
- `!<command>`: run a shell command directly in chat

Direct shell in chat:

```bash
!pwd
!git status
!yarn test
```

Read-oriented commands stay in inspect mode when possible. Workspace-changing or unclassified commands fall back to approval-gated execution.

Chat state is stored under `.heddle/`, including saved sessions, traces, approvals, and memory notes. The footer context indicator is an estimate of total request input against the active model's context window, not only the raw chat history length.

For local development against the sibling CyberLoop repo, run chat with the middleware module path:

```bash
HEDDLE_CYBERLOOP_ADVANCED_MODULE=/Users/roackb2/Studio/projects/CyberLoop/src/advanced/kinematics-middleware.ts yarn chat:dev:openai
```

Drift telemetry is enabled by default for new sessions. For installed usage, install the optional `cyberloop` peer dependency in the same environment as Heddle so it can dynamically import `cyberloop/advanced`.

### CLI Commands

Supported commands:

- `heddle` or `heddle chat`: start interactive chat mode
- `heddle ask "<goal>"`: run a single prompt and exit
- `heddle heartbeat start [--every 30m] [--task "<durable task>"]`: create or enable the default heartbeat task and run the foreground scheduler
- `heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m]`: create or update a scheduled heartbeat task
- `heddle heartbeat task list`: list local heartbeat tasks
- `heddle heartbeat task show <id>`: show a task's schedule, last decision, and last run summary
- `heddle heartbeat task enable <id>` / `heddle heartbeat task disable <id>`: toggle a heartbeat task
- `heddle heartbeat run --once`: run due heartbeat tasks once
- `heddle heartbeat run [--poll 60s]`: run the foreground heartbeat scheduler until interrupted; heartbeat runs print scheduler, agent, tool, decision, and checkpoint progress events
- `heddle heartbeat runs list [--task <id>] [--limit 10]`: list saved heartbeat run records
- `heddle heartbeat runs show <run-id|latest> [--task <id>]`: show the final agent output for a saved heartbeat run
- `heddle init`: create a `heddle.config.json` template in the current project

Common flags:

- `--cwd <path>`: run against another workspace root
- `--model <name>`: choose the active model
- `--max-steps <n>`: limit the agent loop length

## Control Plane

Heddle includes an early local browser control plane for users who want a native UI instead of only terminal chat or third-party messaging apps.

This is still WIP. The current version is useful for read-only oversight, but it is not yet a full replacement for the TUI.

Current stack:

- `src/server`: Express-hosted tRPC server
- `src/web`: React/Vite web client
- `src/server/features/control-plane`: control-plane-specific server feature logic
- pino logs written locally for debugging

Start the daemon from a workspace:

```bash
heddle daemon
```

By default, the daemon binds to `127.0.0.1:8765` and serves the built web app plus the tRPC API. The first implementation surfaces:

- workspace and `.heddle/` state location
- saved chat session inventory
- heartbeat task status
- recent heartbeat run summaries and usage

You can override host and port:

```bash
heddle daemon --host 127.0.0.1 --port 8765
```

For local development, run the server and client separately:

```bash
yarn server:dev
yarn client:dev
```

`yarn server:dev` starts the tRPC server at `127.0.0.1:8765`. `yarn client:dev` starts the Vite client and proxies `/trpc` to the server.

The server writes pino logs to `.heddle/logs/server.log` by default. Override the path with:

```bash
HEDDLE_SERVER_LOG_FILE=/path/to/server.log yarn server:dev
```

This control plane is intentionally read-only at first. The next milestones are session detail views, chat continuation from the browser, heartbeat task actions, and live run updates.

## Knowledge Persistence

Heddle can maintain durable workspace knowledge under `.heddle/memory/`.

The goal is to help Heddle learn from real project work over time instead of rediscovering the same stable facts every session.

Typical examples:

- architecture notes that future sessions should reuse
- recurring build, test, or environment quirks
- important repo conventions and command patterns
- durable findings from completed implementation work

The memory model is intentionally simple:

- memory is stored as readable markdown files in the project state directory
- Heddle can list, read, search, and edit those notes
- shell tools are still available when flexible retrieval or editing is needed
- memory is meant for stable, reusable knowledge, not scratch notes or speculative plans

This is one of Heddle's more distinctive host-side capabilities: the aim is not just to answer the current prompt, but to let the runtime accumulate project understanding from your operations and become more useful across sessions.

## Semantic Drift

Heddle can show whether the agent's responses are drifting away from the recent semantic trajectory of the conversation.

The CyberLoop workflow is observe-only. Drift telemetry is enabled by default for new chat sessions when `cyberloop` is available. Heddle loads real [CyberLoop](https://www.npmjs.com/package/cyberloop) kinematics middleware, embeds agent output frames with OpenAI embeddings, compares the current response trajectory against the previous assistant response when available, shows `drift=unknown|low|medium|high` in the footer, highlights medium/high drift in the status bar, and writes `cyberloop.annotation` events into saved traces.

Tool outputs are excluded from chat drift scoring so the signal focuses on where the agent's own responses are heading. Chat drift uses a more sensitive default stability threshold than CyberLoop's library default; set `HEDDLE_DRIFT_STABILITY_THRESHOLD` if you want to tune it. The toggle is saved on the active chat session, and `/drift` reports the last unavailable reason if the middleware or embeddings fail.

Heddle does not calculate semantic drift itself. For the underlying methodology, see the [CyberLoop repository](https://github.com/roackb2/cyberloop) and [paper](https://zenodo.org/records/18138161).

## Heartbeat

Heddle exposes `runAgentHeartbeat` for autonomous, scheduler-driven agent work.

Heartbeat is not an interactive chat mode. It is a host/runtime primitive for systems that want to wake an agent periodically, let it work within budget and approval limits, checkpoint the result, and decide what should happen next.

A heartbeat wake cycle:

- loads a durable task plus an optional checkpoint
- resumes prior transcript state if available
- lets the agent do bounded useful work without a human prompt
- checkpoints the new state
- returns a decision: `continue`, `pause`, `complete`, or `escalate`

This is intended for hosted workers, local schedulers, long-running agents, and systems like agent social platforms where agents need to keep working over time without staying in a live chat session.

Heartbeat uses a larger default step budget than ordinary short chat runs so a wake cycle has room to inspect, act, and checkpoint. Hosts can still pass `maxSteps` when they need stricter control.

The built-in CLI heartbeat runner is intentionally conservative: it has no live approval UI, so approval-gated file edits and mutation shell commands are denied with a clear blocker. It is useful today for recurring inspection, summaries, memory-note updates, and escalation reports. Hosts can provide their own `approveToolCall` policy when they want autonomous agents to perform broader actions.

For repeated wake cycles, Heddle also exposes a local-first scheduler core:

- `runDueHeartbeatTasks`: scan a task store once, run due tasks, save checkpoints, and update next-run state
- `runHeartbeatScheduler`: run the same scan loop until an `AbortSignal` stops it
- `createFileHeartbeatTaskStore`: store task definitions and checkpoints under `.heddle/heartbeat/`-style directories

Cron, launchd, systemd, hosted queues, and Lucid-style services should be treated as hosts around this API, not as Heddle's internal scheduler model.

Try a small local heartbeat example:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:heartbeat
```

The example stores its checkpoint at `.heddle/examples/heartbeat-demo-checkpoint.json`, so running it again resumes from the previous wake cycle.

Try the local scheduler API with a real LLM:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:heartbeat-scheduler
```

The scheduler example writes task, checkpoint, and run records under `.heddle/examples/heartbeat-scheduler/`.

The installed CLI also exposes the local heartbeat scheduler:

```bash
heddle heartbeat start --every 30m
heddle heartbeat task add --id repo-gardener --task "Check for safe maintenance work" --every 1h
heddle heartbeat task list
heddle heartbeat task show repo-gardener
heddle heartbeat run --once
heddle heartbeat run --poll 60s
heddle heartbeat runs list --task repo-gardener
heddle heartbeat runs show latest --task repo-gardener
```

For an OpenClaw-like local experience, `heartbeat start` creates or enables a default periodic task and runs the foreground scheduler in one command. It prints the agent's final summary and decision after each run. Stop it with `Ctrl+C`.

For programmatic hosts, heartbeat now also exposes compact task/run views and a thin host-adapter layer, so external apps can consume stable status/progress/response payloads without parsing raw CLI output or full trace history.

Inside this repository, use the dev CLI entrypoint instead:

```bash
yarn cli:dev heartbeat start --every 30m
```

Adding a task only saves scheduler state; it does not start a background process. Stop a foreground scheduler with `Ctrl+C`, or pause a task with:

```bash
heddle heartbeat task disable repo-gardener
```

For hosts that want storage handled by Heddle, use `runStoredHeartbeat` with a checkpoint store:

```ts
import { createFileHeartbeatCheckpointStore, runStoredHeartbeat } from '@roackb2/heddle'

const result = await runStoredHeartbeat({
  task: 'Keep this project moving when safe autonomous progress is available',
  store: createFileHeartbeatCheckpointStore({
    path: '.heddle/heartbeat/project-maintenance.json',
  }),
})

// result.nextDelayMs is a scheduling hint. The host still owns the timer,
// cron job, queue, worker, or hosted scheduler that wakes the agent again.
```

For hosts that want task scheduling handled by Heddle, use the scheduler API:

```ts
import { createFileHeartbeatTaskStore, runHeartbeatScheduler } from '@roackb2/heddle'

const controller = new AbortController()

await runHeartbeatScheduler({
  store: createFileHeartbeatTaskStore({ dir: '.heddle/heartbeat' }),
  pollIntervalMs: 60_000,
  signal: controller.signal,
})
```

To read compact task/run state back out for dashboards or hosted controllers:

```ts
import {
  createFileHeartbeatTaskStore,
  listHeartbeatTaskViews,
  listHeartbeatRunViews,
} from '@roackb2/heddle'

const store = createFileHeartbeatTaskStore({ dir: '.heddle/heartbeat' })

const tasks = await listHeartbeatTaskViews(store)
const runs = await listHeartbeatRunViews(store, { taskId: 'repo-gardener', limit: 5 })
```

Those views are intentionally smaller than full checkpoints or traces. They expose stable operator-facing fields such as task ID, status, progress, decision, outcome, resumability, usage, and latest summary.

## Programmatic Use

The npm package exports a programmatic execution loop for building other agent hosts on top of Heddle.

Use `runAgentLoop` when you want Heddle to assemble the model adapter, default tool bundle, memory tools, and event stream:

```ts
import { runAgentLoop } from '@roackb2/heddle'

const result = await runAgentLoop({
  goal: 'Inspect this repo and summarize the main architecture',
  model: 'gpt-5.1-codex',
  workspaceRoot: process.cwd(),
  onEvent(event) {
    // Render progress, persist traces, feed middleware, or bridge into another app.
    console.log(event.type)
  },
})
```

Persist `result.state` or wrap it with `createAgentLoopCheckpoint(result.state)` when another host needs to continue later:

```ts
import { createAgentLoopCheckpoint, runAgentLoop } from '@roackb2/heddle'

const checkpoint = createAgentLoopCheckpoint(result.state)

await runAgentLoop({
  goal: 'Continue from the prior run and identify the next action',
  resumeFrom: checkpoint,
})
```

The loop emits structured events for:

- loop start and finish
- assistant streaming updates
- trace events such as tool calls, tool results, approvals, and final outcome

The returned result also includes a serializable `state` object with the model, provider, workspace root, outcome, transcript, trace, usage, and timestamps. This is the boundary future hosts can persist for background execution, dashboards, middleware, or heartbeat-style continuation.

For host UIs or controllers that do not want to understand Heddle's full trace/event model, the package also exports compact heartbeat views plus a thin status/progress/response adapter layer:

```ts
import {
  createFileHeartbeatTaskStore,
  heartbeatSchedulerEventToLucidMessages,
  heartbeatTaskViewToLucidMessages,
  listHeartbeatTaskViews,
} from '@roackb2/heddle'

const store = createFileHeartbeatTaskStore({ dir: '.heddle/heartbeat' })
const tasks = await listHeartbeatTaskViews(store)

for (const task of tasks) {
  const messages = heartbeatTaskViewToLucidMessages(task)
  console.log(messages)
}

const schedulerMessages = heartbeatSchedulerEventToLucidMessages({
  type: 'heartbeat.task.started',
  taskId: 'repo-gardener',
  loadedCheckpoint: true,
  status: 'running',
  progress: 'Resuming heartbeat wake from the last checkpoint.',
  timestamp: new Date().toISOString(),
})
```

The adapter names are Lucid-oriented because that is one target host, but the payload shape is generic: compact status, progress, and response messages that another app can publish over websockets, SSE, or logs.

For passive semantic-drift experiments, `createCyberLoopObserver` can consume Heddle's event stream and run CyberLoop-compatible middleware over normalized runtime frames:

```ts
import {
  createCyberLoopObserver,
  createRuntimeFrameEmbedder,
  runAgentLoop,
} from '@roackb2/heddle'
import { kinematicsMiddleware } from 'cyberloop/advanced'

const frameEmbedder = createRuntimeFrameEmbedder({
  async embedText(text) {
    return embedWithYourProvider(text)
  },
})

const observer = createCyberLoopObserver({
  middleware: [
    kinematicsMiddleware({
      embedder: frameEmbedder,
      goalEmbedding: await embedWithYourProvider('Investigate this repo'),
    }),
  ],
  onAnnotation(annotation) {
    console.log(annotation.driftLevel, annotation.frame.kind)
  },
})

await runAgentLoop({
  goal: 'Investigate this repo',
  onEvent: observer.handleEvent,
})
await observer.flush()
```

This is intentionally observe-only. Heddle still owns execution, tools, approvals, and checkpoints; CyberLoop-style middleware can annotate the run without steering or halting it. Heddle does not calculate semantic drift itself; actual drift signals should come from CyberLoop metadata such as kinematics, manifold, or Grassmannian channels.

For autonomous background work, `runAgentHeartbeat` runs one wake cycle from a durable task and optional checkpoint:

```ts
import { runAgentHeartbeat } from '@roackb2/heddle'

const heartbeat = await runAgentHeartbeat({
  task: 'Check whether there is safe maintenance work to do for this project',
  checkpoint,
  maxSteps: 8,
})

// Persist heartbeat.checkpoint, then schedule the next wake based on heartbeat.decision.
```

Heartbeat is not chat by default. It is meant for scheduler-driven agents that wake up, reload state, do bounded autonomous work, checkpoint, and either continue, pause, complete, or escalate.

For repeated local or hosted wake cycles, `runDueHeartbeatTasks`, `runHeartbeatScheduler`, and `createFileHeartbeatTaskStore` provide the scheduler layer above one-shot heartbeat runs.

Lower-level pieces are still exported for custom hosts, including:

- `runAgent`
- `runAgentLoop`
- `runAgentHeartbeat`
- `runHeartbeatScheduler`
- `createFileHeartbeatTaskStore`
- `createDefaultAgentTools`
- LLM adapter helpers
- built-in tools
- trace utilities

Install as a dependency with:

```bash
npm install @roackb2/heddle
```

If you want CyberLoop middleware examples or chat drift telemetry, install the optional peer dependency in the same project:

```bash
npm install cyberloop
```

For a small real-LLM example of embedding the loop with a custom host tool:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:programmatic
```

To try the same example with Claude:

```bash
export ANTHROPIC_API_KEY=your_key_here
HEDDLE_EXAMPLE_MODEL=claude-3-5-haiku-latest yarn example:programmatic
```

For a small no-network observer example:

```bash
yarn example:cyberloop-observer
```

The public API lives in [src/index.ts](/Users/roackb2/Studio/projects/ProjectHeddle/heddle/src/index.ts).

## Capability Details

Heddle currently supports:

- repository inspection with `list_files`, `read_file`, and `search_files`
- code and doc changes with `edit_file`
- provider-backed hosted web search through `web_search`
- local screenshot and image inspection through `view_image`
- native browser control plane through `heddle daemon`
- inline `@file` mentions for file-priority context without pasting file contents into the prompt
- shell execution with inspect vs approval-gated mutate behavior
- multi-turn chat sessions with saved history under `.heddle/`
- session management with create, switch, continue, rename, and close flows
- automatic conversation compaction so longer chats preserve context instead of growing unbounded
- manual `/compact` to shrink the current session transcript on demand
- persistent workspace memory notes under `.heddle/memory/`
- serializable run checkpoints for programmatic hosts and later continuation
- short working-plan support through `update_plan` for substantial multi-step tasks
- remembered per-project approvals for repeated commands and edits
- interrupt and resume support for longer-running coding workflows
- request-size aware context tracking in chat so the footer reflects model input usage, not only raw history size

The image workflow is intentionally simple for now: users can reference a local image path in chat, and the agent can decide whether to inspect it with `view_image`. Heddle does not require a full multimodal attachment model for this first version.

The file-mention workflow is also intentionally lightweight: `@path/to/file` tells Heddle that the file is important context and should be inspected before answering, but it does not automatically inline the file contents into the prompt.

The planning workflow is also intentionally lightweight: Heddle does not force a heavyweight planner or a separate "plan mode," but it can automatically record and update a short plan when a task is substantial enough to benefit from visible progress tracking.

The web-search workflow is provider-backed rather than crawler-backed: OpenAI models use OpenAI-hosted web search, and Anthropic models use Anthropic-hosted web search when available through the selected model/tool path.

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
  "maxSteps": 100,
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
