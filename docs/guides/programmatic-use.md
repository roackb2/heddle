# Programmatic Use

Heddle exports several runtime layers for hosts that want to build on top of the project instead of only using the CLI.

For the contributor-facing dependency map behind these APIs, see
[Core Layering](../architecture/core-layering.md).

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

### Use `EngineConversationTurnService.run(...)` only for low-level persisted turn execution

Use `EngineConversationTurnService.run(...)` only when your host already owns session ids and storage paths and you intentionally want the lower-level persisted turn runner.

For most hosts, `createConversationEngine` is the better entrypoint. It keeps session creation, target resolution, and turn submission behind one surface instead of making the host assemble those boundaries manually.

Compared with `createConversationEngine`, this is lower-level and more manual:

- you pass `workspaceRoot`, `stateRoot`, `sessionStoragePath`, `sessionId`, and other turn options directly
- you are closer to the engine internals
- you still get persisted session behavior, compaction, approvals, trace persistence, and memory maintenance

### Use `AgentLoopRuntimeService.run(...)` for single-run embedding

Use `AgentLoopRuntimeService.run(...)` when you want an evented agent run without the persisted conversation/session layer.

This is the right choice when you want:

- one bounded run for a goal
- direct access to the loop event stream
- default tools and model assembly without chat session persistence
- checkpointable state that your own host will manage

`AgentLoopRuntimeService.run(...)` is not the main persisted conversation API.
It is the host-facing runtime wrapper over the lower-level agent run loop that
the conversation engine builds on.

### Use heartbeat APIs for scheduled or background runner cycles

Use `HeartbeatRunnerAgent.run`, `StoredHeartbeatService.run`, `HeartbeatSchedulerService.runDueTasks`, and `HeartbeatSchedulerService.runLoop` when you want bounded autonomous work that runs from durable task/checkpoint state.

Use heartbeat APIs when you want:

- scheduled maintenance or monitoring tasks
- repeated runner cycles around a durable task definition
- host-managed task/run stores and review views
- explicit operator-controlled or agent-selected continuation policy for recurring work
- escalation-oriented background workflows

Heartbeat is for task scheduling and bounded background work, not for ordinary interactive persisted chat sessions.

## Main Entry Point: `createConversationEngine` Alpha

The conversation engine API is alpha. It is intended for real use and examples, but it should still be treated as an evolving programmatic surface.

```ts
import { createConversationEngine } from '@roackb2/heddle'

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.4',
  reasoningEffort: 'medium',
})

const session = engine.sessions.create({ name: 'Repo investigation' })

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize the architecture of this repository.',
})

console.log(result.summary)
```

`reasoningEffort` can also be set per session:

```ts
const session = engine.sessions.create({
  name: 'Deep repo investigation',
  model: 'gpt-5.5',
  reasoningEffort: 'high',
})
```

Supported OpenAI request values are `low`, `medium`, and `high`. `ultrahigh` is reserved in Heddle's persisted type surface, but current OpenAI Responses API requests reject it instead of silently falling back to a default.

## Where State Is Stored

The conversation engine is workspace-scoped and state-root-scoped.

At a high level:

- `workspaceRoot` is the repository or project the agent should work inside
- `stateRoot` is the local Heddle state directory for the host using the engine

By default, the normalized engine config derives these paths from `stateRoot`:

- session catalog: `stateRoot/chat-sessions.catalog.json`
- per-session bodies: `stateRoot/chat-sessions/<session-id>.json`
- memory directory: `stateRoot/memory`
- trace directory: `stateRoot/traces`
- Agent Skills activation state: `stateRoot/skills/activation.json`

For ordinary Heddle usage, that state root is typically the workspace-local `.heddle/` directory.
The current session storage format is the catalog plus per-session JSON files; older flat `chat-sessions.json` files are not migrated or read.

## Agent Skills In Programmatic Hosts

Programmatic hosts can use the same Agent Skills support as the CLI. Heddle
discovers standard skills from `.agents/skills/<name>/SKILL.md` and
`~/.agents/skills/<name>/SKILL.md`, stores only workspace activation status
under the configured `stateRoot`, and exposes active skills through progressive
disclosure.

When active skills exist and the default `read_agent_skill` tool is available,
the runtime appends a compact `<available_skills>` catalog to the system
context. The model can then call `read_agent_skill` to read one active
`SKILL.md` body or a linked resource under `scripts/`, `references/`, or
`assets/`.

Skills are instructions, not permissions. Hosts still own approval callbacks,
tool policy, workspace boundaries, and any UI needed for activation management.

## Host Extensions

Programmatic hosts can add their own domain capabilities at engine creation
time. `hostExtensions.tools` accepts ordinary `ToolDefinition` values.
`hostExtensions.toolkits` accepts `ToolToolkit` values that receive the resolved
runtime context and can create tools from host state.

Heddle appends host-provided tools and toolkits to the default runtime bundle
before applying custom-agent tool profiles.

```ts
import {
  createConversationEngine,
  defineHostExtension,
  type ToolDefinition,
  type ToolToolkit,
} from '@roackb2/heddle'

const createReportTool: ToolDefinition = {
  name: 'create_project_brief',
  description: 'Create a project brief from a structured prompt.',
  capabilities: ['workspace.write'],
  parameters: {
    type: 'object',
    properties: {
      brief: { type: 'string' },
    },
    required: ['brief'],
  },
  execute: async (input) => {
    return { ok: true, output: { documentId: 'brief-123', input } }
  },
}

const projectBriefToolkit: ToolToolkit = {
  id: 'project-brief',
  createTools(context) {
    return [
      {
        ...createReportTool,
        description: `${createReportTool.description} Workspace: ${context.workspaceRoot}`,
      },
    ]
  },
}

const projectBriefExtension = defineHostExtension({
  id: 'project-brief-workspace',
  toolkits: [projectBriefToolkit],
  systemContext: 'When generating durable project briefs, save source and preview files as artifacts.',
  artifacts: {
    enabled: true,
  },
})

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.4',
  hostExtensions: [projectBriefExtension],
})
```

Use `defineHostExtension(...)` for new SDK integrations. It validates the
extension id plus duplicate host tool and toolkit names before the first turn
runs. `hostExtensions` accepts either one legacy object or an ordered array of
defined extensions. When multiple extensions are provided, Heddle composes them
in declaration order:

- `tools` are appended in order.
- `toolkits` are appended in order.
- `systemContext` blocks are joined with blank lines in order.
- `artifacts` options are merged in order, with later `enabled` or `root`
  values overriding earlier values.
- `mcp.hideDefaultServers` values are de-duplicated and passed to the default
  MCP toolkit so curated host tools do not compete with raw generic MCP tools.

Host tools must use unique names. If a host tool collides with a built-in tool
name, Heddle rejects the runtime bundle instead of silently overriding
behavior. Host toolkits must also use unique toolkit ids.

### MCP Host Extensions

If your host already has an MCP server, you do not need to copy every MCP tool
schema into hand-written Heddle tools. Configure and refresh the MCP server in
Heddle state, then use `defineMcpHostExtension(...)` to expose selected cached
MCP tools as a host extension.

This is useful when a host wants a domain-specific prompt, artifact behavior, or
tool naming surface while still letting MCP own the tool schemas and call
protocol.

```ts
import {
  createConversationEngine,
  defineMcpHostExtension,
  prepareMcpHostExtension,
} from '@roackb2/heddle'

const presentation = await prepareMcpHostExtension({
  id: 'presentation',
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  serverId: 'slides',
  server: {
    type: 'stdio',
    command: 'npm',
    args: ['run', 'mcp'],
    tools: {
      approval: 'never',
    },
  },
  includeTools: ['create_deck', 'validate_deck', 'export_html'],
  systemContext: [
    'Use presentation tools when the user asks for deck creation or revision.',
    'Save reusable source and preview outputs as artifacts when appropriate.',
  ].join('\n'),
  artifacts: {
    enabled: true,
  },
})

if (!presentation.ok) {
  throw new Error(`Failed to prepare MCP extension: ${presentation.step}: ${presentation.error}`)
}

const knowledgeBaseExtension = defineMcpHostExtension({
  id: 'knowledge-base',
  serverId: 'notion',
  includeTools: ['search_pages', 'create_page'],
  systemContext: 'Use the knowledge base tools for durable team documentation.',
})

const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.4',
  hostExtensions: [
    presentation.extension,
    knowledgeBaseExtension,
  ],
})
```

By default, Heddle keeps the MCP tool names, descriptions, and input schemas
from the cached MCP catalog. Use `toolNamePrefix` only when multiple MCP
servers expose overlapping tool names in the same engine:

```ts
const presentationExtension = defineMcpHostExtension({
  id: 'presentation',
  serverId: 'slides',
  includeTools: ['create_deck'],
  toolNamePrefix: 'slides',
})
```

Use `toolOverrides` only when the host needs a sharper name, description,
capability, or approval behavior:

```ts
const presentationExtension = defineMcpHostExtension({
  id: 'presentation',
  serverId: 'slides',
  includeTools: ['create_deck'],
  hideDefaultMcpTools: true,
  toolOverrides: {
    create_deck: {
      name: 'presentation_create_deck',
      description: 'Create a deck using the host presentation workspace.',
      capabilities: ['workspace.write'],
    },
  },
})
```

Set `hideDefaultMcpTools: true` when the host extension is the intended tool
surface for that MCP server. Heddle will still call the same MCP server behind
the scenes, but the default `mcp_list_tools`, `mcp_call_tool`, and
`mcp__server__tool` paths will not expose that server to the model.

Use `resultArtifacts` when an MCP tool returns a large generated value that
should be persisted and inspected through artifact tools instead of copied back
into the model context:

```ts
const presentationExtension = defineMcpHostExtension({
  id: 'presentation',
  serverId: 'slides',
  includeTools: ['export_html'],
  hideDefaultMcpTools: true,
  resultArtifacts: [{
    toolName: 'export_html',
    path: 'html',
    kind: 'html',
    domain: 'preview',
    title: 'presentation-preview.html',
    extension: 'html',
    mimeType: 'text/html',
    maxPreviewChars: 800,
  }],
})
```

`resultArtifacts` paths point into the MCP tool result output. When the path is
present, Heddle saves the value under the configured artifact root and replaces
that field with `{ artifact, contentPath, preview, omittedCharacters }`. The
full content remains available through `read_artifact`, while the model sees a
small preview plus the artifact id and relative path.

`defineMcpHostExtension(...)` reads the cached MCP catalog when a turn builds
its tool bundle. It does not launch MCP servers or refresh catalogs during the
turn. Use `prepareMcpHostExtension(...)` before creating the engine when your
host owns the MCP server definition. That keeps turn startup synchronous and
predictable while still giving SDK hosts a one-call setup path.

Use `capabilities` when you want custom-agent tool profiles to filter host
tools by read/write or domain-specific access. `tools` is still accepted at the
top level for compatibility, but new hosts should prefer
`hostExtensions: [defineHostExtension(...)]`.

## Artifact Tools

The default runtime bundle includes generic artifact tools:

- `artifact_dashboard`
- `list_artifacts`
- `read_artifact`
- `save_artifact`
- `set_current_artifact`

Artifacts are stored under `stateRoot/artifacts` by default. Programmatic hosts
can override the root or disable artifact tools:

```ts
const engine = createConversationEngine({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  model: 'gpt-5.4',
  hostExtensions: {
    artifacts: {
      root: `${process.cwd()}/.heddle/project-artifacts`,
      enabled: true,
    },
  },
})
```

Artifact tools are general. A presentation host can save MotionDoc source and
HTML preview artifacts, while another host can save reports, diagrams, JSON
outputs, or generated documents through the same runtime path.

## Host Callbacks

`createConversationEngine` accepts host callbacks per submitted turn through `host`.

The current host surface is organized around:

- `events.onActivity`
- `approvals.requestToolApproval`
- `trace.onEvent`
- `compaction.onStatus`
- `events.onEvent` as a lower-level runtime event escape hatch

### `events.onActivity`

`events.onActivity` receives semantic `ConversationActivity` records projected from runtime events, trace events, and compaction status updates.

Use this when you want a UI timeline or host-visible progress without parsing raw loop or trace internals yourself.
Assistant response streaming is delivered here as `assistant.stream` activity.
Runtime and compaction activities use the same top-level fields that UI hosts consume; raw trace-derived activities keep their original `event` payload for evidence-oriented details.

### `approvals.requestToolApproval`

`approvals.requestToolApproval` is the host approval surface for approval-gated tools.

Use this when your host wants to review and allow/deny tool calls such as shell mutation or file edits.

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
  RuntimeCredentialService,
} from '@roackb2/heddle'

const model = process.env.HEDDLE_EXAMPLE_MODEL ?? 'gpt-5.1-codex-mini'
const provider = inferProviderFromModel(model)
const apiKey = RuntimeCredentialService.resolveProviderApiKey(provider)

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

let streamedAssistantText = ''
const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize this repository and list the main verification commands.',
  host: {
    events: {
      onActivity(activity) {
        if (activity.type === 'assistant.stream') {
          process.stdout.write(activity.text.slice(streamedAssistantText.length))
          streamedAssistantText = activity.text
          return
        }
        console.log('[activity]', activity.type)
      },
    },
    approvals: {
      async requestToolApproval(request) {
        console.log('[approval]', request.call.tool)
        return { approved: false, reason: 'Denied by example host policy.' }
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

## `EngineConversationTurnService.run(...)`

If you already manage session ids and paths yourself and want one persisted turn without building the engine service first, call `EngineConversationTurnService.run(...)` directly:

```ts
import { EngineConversationTurnService } from '@roackb2/heddle'

const result = await EngineConversationTurnService.run({
  workspaceRoot: process.cwd(),
  stateRoot: `${process.cwd()}/.heddle`,
  sessionStoragePath: `${process.cwd()}/.heddle/chat-sessions.catalog.json`,
  traceDir: `${process.cwd()}/.heddle/traces`,
  sessionId: 'session-123',
  prompt: 'Continue investigating the current issue.',
})
```

`EngineConversationTurnService.run(...)` does not take a `model` argument directly. It resolves the active model from the stored session model plus runtime credential policy. If your host wants to set model defaults up front, `createConversationEngine` is the easier path.

Choose this only when your host already owns session creation/storage details and only needs the low-level persisted turn runner. For new hosts, prefer `createConversationEngine`.

## `AgentLoopRuntimeService.run(...)`

Use `AgentLoopRuntimeService.run(...)` for lower-level single-run execution when you do not need persisted conversation sessions:

```ts
import { AgentLoopRuntimeService } from '@roackb2/heddle'

const result = await AgentLoopRuntimeService.run({
  goal: 'Inspect this repo and summarize the main architecture',
  model: 'gpt-5.4',
  reasoningEffort: 'medium',
  workspaceRoot: process.cwd(),
  onEvent(event) {
    console.log(event.type)
  },
})
```

Persist `result.state` directly, or wrap it with `createAgentLoopCheckpoint(result.state)` when another host needs to continue later.

## Heartbeat APIs

For bounded autonomous background work, use `HeartbeatRunnerAgent.run` and the scheduler/task repository:

```ts
import { HeartbeatRunnerAgent } from '@roackb2/heddle'

const heartbeat = await HeartbeatRunnerAgent.run({
  task: 'Check whether there is safe maintenance work to do for this project',
  checkpoint,
  maxSteps: 8,
})
```

The scheduler path stores the runner-agent result as one `AgentHeartbeatResult`.
Task state keeps that result under `state.result`, and run history persists the
same result inside each run record. That means hosts can use the same shape for
the latest task status, saved run history, and `heartbeat.task.finished` events
instead of maintaining separate flattened copies.

`FileHeartbeatTaskService` owns durable task operations such as create, update,
enable, disable, delete, resume, list views, and read saved runs. Use it when a
host needs the same task semantics as the CLI and browser control plane instead
of maintaining a parallel task store.

For repeated local or hosted runner cycles, Heddle also exports:

- `HeartbeatSchedulerService.runDueTasks`
- `HeartbeatSchedulerService.runLoop`
- `FileHeartbeatTaskService`
- `FileHeartbeatCheckpointRepository`
- `StoredHeartbeatService.run`
- `FileHeartbeatTaskService.listTaskViews`
- `FileHeartbeatTaskService.listRunViews`
- `FileHeartbeatTaskService.readRun`

These are useful when you want to provide your own surrounding host, queue, cron, service manager, or control surface.

## Host Adapters And Observer Utilities

The package also exports compact heartbeat task/run views and the Lucid
presenter for hosts that do not want to consume the full task/run record shape
directly.

For passive semantic-drift experiments, `createCyberLoopObserver` can consume Heddle's event stream and run CyberLoop-compatible middleware over normalized runtime frames.

## Lower-Level Class Utilities

Some lower-level APIs are exported for hosts that intentionally assemble their
own runtime or review surfaces:

- `ToolRegistry`, `ToolExecutionService`, and `ToolBundleComposer` for custom
  tool execution and toolkit composition.
- `TraceRecorder` and `TraceConsoleFormatter` for raw trace capture and
  terminal-style trace rendering.
- `ReviewDiffParser` for turning unified Git diff text into Heddle's structured
  review model.
- `AgentStepBudget` for hosts that reuse the inner agent-loop step budget
  primitive directly.

These are building blocks. Prefer `createConversationEngine`,
`AgentLoopRuntimeService.run(...)`, or heartbeat services when you want a
complete workflow.

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
