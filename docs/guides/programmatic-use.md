# Programmatic Use

The npm package exports runtime primitives for hosts that want to build on top of Heddle instead of only using the CLI.

## Main Entry Points

### `runAgentLoop`

Use `runAgentLoop` when you want Heddle to assemble the model adapter, default tool bundle, memory tools, and event stream for a normal agent run:

```ts
import { runAgentLoop } from '@roackb2/heddle'

const result = await runAgentLoop({
  goal: 'Inspect this repo and summarize the main architecture',
  model: 'gpt-5.1-codex',
  workspaceRoot: process.cwd(),
  onEvent(event) {
    console.log(event.type)
  },
})
```

Persist `result.state` directly, or wrap it with `createAgentLoopCheckpoint(result.state)` when another host needs to continue later.

### `runAgentHeartbeat`

For autonomous background work, `runAgentHeartbeat` runs one bounded wake cycle from a durable task and optional checkpoint:

```ts
import { runAgentHeartbeat } from '@roackb2/heddle'

const heartbeat = await runAgentHeartbeat({
  task: 'Check whether there is safe maintenance work to do for this project',
  checkpoint,
  maxSteps: 8,
})
```

## Scheduler Helpers

For repeated local or hosted wake cycles, Heddle also exports:

- `runDueHeartbeatTasks`
- `runHeartbeatScheduler`
- `createFileHeartbeatTaskStore`
- `createFileHeartbeatCheckpointStore`
- `listHeartbeatTaskViews`
- `listHeartbeatRunViews`

These are useful when you want to provide your own surrounding host, queue, cron, service manager, or control surface.

## Host Adapters And Observer Utilities

The package also exports compact heartbeat views plus a thin status/progress/response adapter layer for hosts that do not want to consume the full trace or event model directly.

For passive semantic-drift experiments, `createCyberLoopObserver` can consume Heddle's event stream and run CyberLoop-compatible middleware over normalized runtime frames.

## Installation

Install the package with:

```bash
npm install @roackb2/heddle
```

If you also want CyberLoop middleware examples or chat drift telemetry, install the optional peer dependency in the same project:

```bash
npm install cyberloop
```

## Example Scripts In This Repository

The repository includes example programs you can study or run directly:

```bash
yarn example:repo-investigator
yarn example:programmatic
yarn example:heartbeat
yarn example:heartbeat-scheduler
yarn example:host-events
yarn example:cyberloop-observer
```

Set a supported provider API key before running examples that invoke a live model.

## Source Of Truth

The public package API lives in [`src/index.ts`](../../src/index.ts).

## See Also

- [Heartbeat guide](heartbeat.md)
- [Providers and models](../reference/providers-and-models.md)
- [Capabilities and tools](../reference/capabilities.md)
- [Development and contributing](development.md)
