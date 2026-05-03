# Programmatic Use

Heddle exports several runtime layers for hosts that want to build on top of the project instead of only using the CLI.

If you want persisted conversations and session continuity, start with `createConversationEngine`.

## Choose The Right API

### Use `createConversationEngine` for persisted conversations and sessions

`createConversationEngine` is the main alpha API for programmatic hosts that want Heddle's conversation/session behavior rather than a one-shot run.

Use it when you want:

- persisted sessions backed by a state root
- create/read/list/rename/delete session operations
- turn submission and continue behavior
- automatic conversation compaction
- approval handling through a host callback
- assistant streaming, trace events, and semantic activity callbacks
- memory maintenance and trace persistence without rebuilding the wiring yourself

This is the best fit for custom frontends, local tools, daemon-like wrappers, or apps that want a real Heddle conversation engine instead of manually assembling the lower-level turn runner.

### Use `runConversationTurn` for low-level persisted turn execution

Use `runConversationTurn` when you want the persisted turn/session machinery, but you do not want to instantiate the higher-level engine service.

It is useful when you already manage session ids and paths yourself and want direct control over one persisted turn at a time.

Compared with `createConversationEngine`, this is lower-level and more manual:

- you pass `workspaceRoot`, `stateRoot`, `sessionStoragePath`, `sessionId`, and other turn options directly
- you are closer to the engine internals
- you still get persisted session behavior, compaction, approvals, trace persistence, and memory maintenance

### Use `runAgentLoop` for single-run embedding

Use `runAgentLoop` when you want an evented agent run without the persisted conversation/session layer.

This is the right choice when you want:

- one bounded run for a goal
- direct access to the loop event stream
- default tools and model assembly without chat session persistence
- checkpointable state that your own host will manage

`runAgentLoop` is not the main persisted conversation API. It is the lower-level execution loop that the conversation engine builds on.

### Use heartbeat APIs for scheduled or background wake cycles

Use `runAgentHeartbeat`, `runStoredHeartbeat`, `runDueHeartbeatTasks`, and `runHeartbeatScheduler` when you want bounded autonomous work that wakes up from durable task/checkpoint state.

Use heartbeat APIs when you want:

- scheduled maintenance or monitoring tasks
- repeated wake cycles around a durable task definition
- host-managed task/run stores and review views
- escalation-oriented background workflows

Heartbeat is for task scheduling and bounded background work, not for ordinary interactive persisted chat sessions.

## Main Entry Point: `createConversationEngine` Alpha

The conversation engine API is alpha. It is intended for real use and examples, but it should still be treated as an evolving programmatic surface.

```ts
import { createConversationEngine } from '@roackb2/heddle'

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.1-codex',
})

const session = engine.sessions.create({ name: 'Repo investigation' })

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize the architecture of this repository.',
})

console.log(result.summary)
```

## Where State Is Stored

The conversation engine is workspace-scoped and state-root-scoped.

At a high level:

- `workspaceRoot` is the repository or project the agent should work inside
- `stateRoot` is the local Heddle state directory for the host using the engine

By default, the normalized engine config derives these paths from `stateRoot`:

- session catalog: `stateRoot/chat-sessions.catalog.json`
- memory directory: `stateRoot/memory`
- trace directory: `stateRoot/traces`

For ordinary Heddle usage, that state root is typically the workspace-local `.heddle/` directory.

## Host Callbacks

`createConversationEngine` accepts host callbacks per submitted turn through `host`.

The current host surface is organized around:

- `events.onActivity`
- `approvals.requestToolApproval`
- `assistant.onText`
- `trace.onEvent`
- `compaction.onStatus`
- `events.onAgentLoopEvent` as a lower-level escape hatch

### `events.onActivity`

`events.onActivity` receives semantic `ConversationActivity` records projected from runtime events, trace events, and compaction status updates.

Use this when you want a UI timeline or host-visible progress without parsing raw loop or trace internals yourself.

### `approvals.requestToolApproval`

`approvals.requestToolApproval` is the host approval surface for approval-gated tools.

Use this when your host wants to review and allow/deny tool calls such as shell mutation or file edits.

### `assistant.onText`

`assistant.onText` receives streamed assistant text chunks during the turn.

Use this when you want streaming output in a custom UI or transport.

### `trace.onEvent`

`trace.onEvent` receives raw `TraceEvent` records.

Use this when you want full run evidence, custom logging, analytics, or your own trace-backed review path.

### `compaction.onStatus`

`compaction.onStatus` receives semantic conversation compaction lifecycle updates.

Use this when your host wants to show that history compaction is running, finished, or failed.

## Realistic Conversation Engine Example

This repository includes a realistic conversation-engine example:

```bash
yarn example:conversation-engine
```

The example:

- creates an engine with `workspaceRoot`, `stateRoot`, `model`, and provider credential behavior
- creates a session
- submits a prompt
- prints semantic activity, approval requests, assistant streaming, trace events, and compaction status
- prints the final outcome and session summary
- fails with a helpful message when the required provider key is missing

See [`examples/conversation-engine.ts`](../../examples/conversation-engine.ts).

## Example: persisted conversation with host callbacks

```ts
import {
  createConversationEngine,
  inferProviderFromModel,
  resolveProviderApiKey,
} from '@roackb2/heddle'

const model = process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini'
const provider = inferProviderFromModel(model)
const apiKey = resolveProviderApiKey(provider)

if (!apiKey) {
  throw new Error(
    `Missing API key for ${provider}. ` +
      'Set OPENAI_API_KEY for OpenAI models or ANTHROPIC_API_KEY for Anthropic models before running this host.'
  )
}

const workspaceRoot = process.cwd()
const stateRoot = `${workspaceRoot}/.heddle`

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot,
  model,
  apiKey,
  preferApiKey: true,
})

const session = engine.sessions.create({
  name: 'Programmatic conversation example',
})

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize this repository and list the main verification commands.',
  host: {
    events: {
      onActivity(activity) {
        console.log('[activity]', activity.type)
      },
    },
    approvals: {
      async requestToolApproval(request) {
        console.log('[approval]', request.call.tool)
        return { approved: false, reason: 'Denied by example host policy.' }
      },
    },
    assistant: {
      onText(text) {
        process.stdout.write(text)
      },
    },
    trace: {
      onEvent(event) {
        console.log('\n[trace]', event.type)
      },
    },
    compaction: {
      onStatus(event) {
        console.log('[compaction]', event.status)
      },
    },
  },
})

console.log('\nOutcome:', result.outcome)
console.log('Summary:', result.summary)
console.log('Session:', result.session.id)
```

## `runConversationTurn`

If you want one persisted turn without building the engine service first, call `runConversationTurn` directly:

```ts
import { runConversationTurn } from '@roackb2/heddle'

const result = await runConversationTurn({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  sessionStoragePath: `${process.cwd()}/.heddle/chat-sessions.catalog.json`,
  traceDir: `${process.cwd()}/.heddle/traces`,
  sessionId: 'session-123',
  prompt: 'Continue investigating the current issue.',
})
```

`runConversationTurn` does not take a `model` argument directly. It resolves the active model from the stored session model plus runtime credential policy. If your host wants to set model defaults up front, `createConversationEngine` is the easier path.

Choose this when your host already owns session creation/storage details and only needs the low-level persisted turn runner.

## `runAgentLoop`

Use `runAgentLoop` for lower-level single-run execution when you do not need persisted conversation sessions:

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

## Heartbeat APIs

For bounded autonomous background work, use `runAgentHeartbeat` and the scheduler/task-store helpers:

```ts
import { runAgentHeartbeat } from '@roackb2/heddle'

const heartbeat = await runAgentHeartbeat({
  task: 'Check whether there is safe maintenance work to do for this project',
  checkpoint,
  maxSteps: 8,
})
```

For repeated local or hosted wake cycles, Heddle also exports:

- `runDueHeartbeatTasks`
- `runHeartbeatScheduler`
- `createFileHeartbeatTaskStore`
- `createFileHeartbeatCheckpointStore`
- `runStoredHeartbeat`
- `suggestNextHeartbeatDelayMs`
- `listHeartbeatTaskViews`
- `listHeartbeatRunViews`
- `loadHeartbeatRunView`

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
yarn example:conversation-engine
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

- [Capabilities and tools](../reference/capabilities.md)
- [Providers and models](../reference/providers-and-models.md)
- [Heartbeat guide](heartbeat.md)
- [Development and contributing](development.md)
