# Heddle

[English](README.md) | [繁體中文](README.zh-TW.md)

**Build agentic experiences into your product—without giving up control of your
architecture.**

Heddle is an open-source TypeScript agent runtime and SDK for durable
conversations, tool and MCP execution, approvals, artifacts, traceable
activity, and reconnectable hosted runs.

Your product keeps control of identity, data relationships, API policy,
deployment, transport, and UI. Start with a working conversation, then adopt
only the Heddle layers your product needs.

Want to see the runtime working before embedding it? Heddle's local coding
agent, terminal UI, and browser control plane are built on the same
conversation and run foundations exposed through the SDK.

Official website: [heddleagent.com](https://heddleagent.com)

Start here:
[SDK quickstart](docs/guides/programmatic/quickstart.md) ·
[choose an integration layer](docs/guides/programmatic/integration-layers.md) ·
[runnable SDK examples](examples/sdk/README.md) ·
[try the coding agent](#try-heddle-as-a-coding-agent)

## Why Heddle

Calling a model and registering a tool is only the beginning of an agentic
product. The harder product work starts when a conversation must survive
multiple turns, expose understandable activity, pause for approval, outlive one
HTTP request, reconnect after a browser refresh, and apply results without
leaking internal state.

Heddle owns those reusable runtime mechanics while leaving product decisions in
the product:

- persisted multi-turn conversations, continuation, compaction, and leases;
- native tools, Agent Skills, and curated MCP-backed host extensions;
- approval requests, semantic activity, traces, artifacts, and typed turn
  results;
- addressable active runs with ordered events, bounded replay, cancellation,
  approval resolution, and one terminal outcome;
- runtime-validated remote envelopes, cursor progression, duplicate and gap
  handling, and bounded reconnect calculation;
- file-backed local defaults plus explicit extension points for host
  capabilities, storage, output, policy, and transport.

Heddle is a good fit for TypeScript teams building document agents, research
assistants, internal copilots, operational agents, or other product experiences
where inspectability and host control matter more than a one-shot chat
endpoint.

## Start Building

### Fastest SDK evaluation

Install the Node runtime package:

```bash
npm install @roackb2/heddle
```

Then start a persisted interactive conversation:

```ts
import { runQuickstartConversationCli } from '@roackb2/heddle'

await runQuickstartConversationCli()
```

The quickstart resolves the workspace, local state root, configured model, and
credential before opening the prompt loop. It is intentionally smaller than
Heddle's product CLI and is the shortest path for evaluating the SDK.

Run the corresponding repository example with:

```bash
yarn example:sdk:interactive
```

See the [SDK quickstart](docs/guides/programmatic/quickstart.md) for model,
credential, prompt, command, and host-extension options.

### Own presentation and turn lifecycle

Move to `createConversationEngine` when your product owns rendering, commands,
approvals, or session browsing:

```ts
import { join } from 'node:path'
import {
  createConversationEngine,
  createConversationTextHost,
} from '@roackb2/heddle'

const workspaceRoot = process.cwd()

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot: join(workspaceRoot, '.heddle'),
  model: process.env.HEDDLE_MODEL ?? 'gpt-5.4',
})

const session = await engine.sessions.create({
  name: 'Product assistant',
})

const textHost = createConversationTextHost({
  output: (text) => process.stdout.write(text),
})

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize this workspace and identify the main verification path.',
  host: textHost.host,
})

textHost.renderTurnResult(result)
```

The text host supplies a working output surface. Replace it with your product's
activity, approval, telemetry, and result handlers when you own the UI. If a
turn must outlive a request or support remote reconnection, continue to the
[hosted agent stack](examples/sdk/05-hosted-agent/README.md).

## Reuse the Runtime, Keep the Product

Heddle is intentionally not a full application framework:

```text
YOUR PRODUCT
  UI state and result application
          |
  @roackb2/heddle-remote + optional HTTP/SSE client
          |
  your API, authentication, public schemas, and product state
========================= HEDDLE SDK =========================
  ConversationRunService
  run identity, ordered activity, replay, cancel, approvals
          |
  ConversationEngine
  sessions, turns, compaction, archives, traces, artifacts
          |
  models, tools, host extensions, MCP
```

| Concern | Heddle owns | Your product owns |
| --- | --- | --- |
| Conversation | Messages, turns, continuation, compaction, leases, and persisted session behavior | Stable product conversation IDs, access rules, and product relationships |
| Execution | Model/tool loop, tool execution, host extensions, traces, activities, and artifacts | Product tools, system context, model choice, credentials, and capability policy |
| Approvals | Request/resolution lifecycle and run integration | Who may approve, approval policy, and approval UI |
| Active runs | Run IDs, ordered sequences, bounded replay, cancellation, and terminal settlement | Process lifetime, routing, draining, and multi-process delivery |
| Remote clients | Runtime envelope validation, cursor/duplicate/gap rules, terminal detection, and reconnect calculation | Public payload schemas, timers, UI state, retry UX, and result presentation |
| Persistence | File-backed defaults and injectable session/archive/artifact repository boundaries | Production adapters, retention, encryption, backup, tenancy, and product records |
| API and UI | Optional Node HTTP/SSE and browser transport mechanics | Server framework, routes, auth, CORS, limits, errors, and every visual decision |

The full ownership model lives in
[Choose a Programmatic Integration Layer](docs/guides/programmatic/integration-layers.md).

## Choose Your Integration Depth

Heddle's public entry points make assumptions explicit. Use the lowest layer
that already owns the mechanics your host needs:

| Host need | Start with | What it adds |
| --- | --- | --- |
| A working local conversation | `runQuickstartConversationCli` | Prompt loop, persisted session, credentials, and text output |
| Custom output, tools, or session UX | `@roackb2/heddle` | Conversation engine, host extensions, tools, MCP, approvals, artifacts, and turn results |
| A server, worker, or Electron backend | `@roackb2/heddle/hosted` | Addressable process-local runs, replay, cancellation, and approval resolution |
| Conventional Node HTTP/SSE | `@roackb2/heddle/hosted/http-sse` | Replay cursor parsing, SSE framing, backpressure, and disconnect cleanup |
| A remote browser or client | `@roackb2/heddle-remote` | Browser-safe protocol validation and transport-neutral run consumption |
| Conventional browser REST/SSE | `@roackb2/heddle-remote/http-sse` | Authenticated fetch, incremental SSE parsing, and transport validation |
| Lower-level runtime assembly | `@roackb2/heddle/advanced` | Model adapters, individual tools, trace, memory, heartbeat, and core runtime services |

Existing tRPC, Fastify, Hono, Nest, WebSocket, IPC, queue, React, or other stacks
should normally keep those choices and adapt the closest neutral Heddle layer.
Do not install Express or React merely because a reference example uses them.

## Progressive SDK Examples

The runnable examples teach customization in small steps:

1. [Interactive chat](examples/sdk/01-interactive-chat.ts) — start a persisted
   conversation.
2. [Add a tool](examples/sdk/02-add-a-tool.ts) — expose native product
   behavior.
3. [Add an MCP server](examples/sdk/03-add-an-mcp-server.ts) — prepare curated
   MCP-backed capabilities without copying schemas.
4. [Custom output](examples/sdk/04-custom-output.ts) — keep conversation
   semantics while replacing presentation.
5. [Hosted agent stack](examples/sdk/05-hosted-agent/README.md) — progress from
   a transport-neutral service to an optional HTTP/SSE API, browser client, and
   React reference.

Each stage states its assumptions and responsibility boundary. Copy only the
layers that match your product.

## Core Capabilities

### Conversations and results

- persisted sessions with create, resume, continue, rename, archive, and
  compaction paths;
- structured conversation activity for text, tools, approvals, lifecycle, and
  progress;
- turn summaries with traces, tool outcomes, artifacts, and safe typed model
  failures;
- artifact capture for generated documents and large tool results, including
  mirror workflows for stateless MCP tools.

### Capabilities and control

- host-owned `ToolDefinition` capabilities and reusable tool registries;
- Agent Skills with workspace activation and progressive disclosure;
- prepared MCP host extensions with curated exposure, overrides, and result
  artifact rules;
- approval policy chains and host-owned approval decisions;
- OpenAI, Anthropic, Ollama, and OpenAI-compatible provider profiles.

### Hosted and remote runs

- one active run per host-defined conversation address;
- stable run IDs, ordered event sequences, bounded replay, explicit
  cancellation, and approval resolution;
- awaited product result projection before a success terminal becomes visible;
- safe public error projection that keeps provider and persistence diagnostics
  on the host;
- a lightweight browser package that excludes Heddle's Node runtime, CLI,
  model providers, server, and control plane.

See the [programmatic guide index](docs/guides/programmatic/README.md) for the
complete ladder.

## Try Heddle as a Coding Agent

The coding agent is the fastest way to experience Heddle's runtime as a
complete product host.

Install the CLI:

```bash
npm install -g @roackb2/heddle
```

Configure one provider. For OpenAI, either use a Platform API key:

```bash
export OPENAI_API_KEY=your_key_here
```

Or opt into experimental OpenAI account sign-in:

```bash
heddle auth login openai
```

Then open any repository:

```bash
cd /path/to/project
heddle
```

Try:

```text
Summarize this repository, identify its main entrypoints, and show me the
commands used to build and test it.
```

For a one-shot saved run:

```bash
heddle ask "Review the current repository and identify the highest-risk change."
```

For browser and mobile oversight of the same conversations:

```bash
heddle daemon
```

![Heddle streams the same session across terminal, browser, and mobile](docs/images/heddle-cross-device-stream.gif)

The reference product also includes saved sessions, reviewable diffs,
workspace memory, Agent Skills, custom agents, MCP integrations, heartbeat
tasks, and opt-in Browser Automation. These are useful product features and
dogfood for the same reusable runtime boundaries.

More:

- [Chat and sessions](docs/guides/chat-and-sessions.md)
- [Control plane](docs/guides/control-plane.md)
- [Providers and models](docs/reference/providers-and-models.md)
- [Capabilities and Browser Automation](docs/reference/capabilities.md)
- [Agent Skills](docs/guides/agent-skills.md)
- [Custom agents](docs/guides/custom-agents.md)
- [Knowledge persistence](docs/guides/knowledge-persistence.md)
- [Heartbeat](docs/guides/heartbeat.md)
- [MCP integrations](docs/reference/mcp.md)

OpenAI account sign-in is an experimental, user-selected transport for Heddle.
It is not official OpenAI support, and Heddle is not affiliated with, endorsed
by, or sponsored by OpenAI. Use of OpenAI services remains subject to OpenAI's
terms and policies.

## Production Posture

Heddle is designed to make assumptions and limitations visible:

- the curated SDK targets Node.js 20+ TypeScript/ESM hosts;
- conversation state is durable through the configured repositories, while
  active-run handles and replay are process-local and bounded;
- multi-process routing and durable in-flight delivery require infrastructure
  selected by the host;
- session, compacted-history archive, and artifact repositories are injectable,
  but production retention, encryption, backup, tenancy, and adapter operations
  remain host responsibilities;
- traces, memory, and some supporting state remain local/path-oriented unless
  the host deliberately provides another integration path;
- HTTP/SSE helpers own wire correctness, not route registration,
  authentication, authorization, CORS, limits, billing, or deployment;
- `@roackb2/heddle-remote` validates the run protocol but does not own product
  messages, UI state, authentication, or result rendering;
- the SDK is actively evolving, so review
  [release notes](docs/releases/README.md) before upgrading public APIs.

Heddle is not a hosted agent SaaS and does not require your product to adopt a
particular identity provider, database, server framework, transport, UI
framework, or deployment platform.

## Documentation

### Build with the SDK

- [Programmatic hosts](docs/guides/programmatic/README.md)
- [SDK quickstart](docs/guides/programmatic/quickstart.md)
- [Integration-layer chooser](docs/guides/programmatic/integration-layers.md)
- [Conversation engine](docs/guides/programmatic/conversation-engine.md)
- [Host extensions](docs/guides/programmatic/host-extensions.md)
- [MCP host extensions](docs/guides/programmatic/mcp-host-extensions.md)
- [Remote conversation runs](docs/guides/programmatic/remote-runs.md)
- [Result artifacts](docs/guides/programmatic/result-artifacts.md)
- [Runnable SDK examples](examples/sdk/README.md)

### Use Heddle locally

- [Documentation hub](docs/README.md)
- [Runtime host model](docs/guides/runtime-host-model.md)
- [Chat and sessions](docs/guides/chat-and-sessions.md)
- [Control plane](docs/guides/control-plane.md)
- [CLI reference](docs/reference/cli.md)
- [Project configuration](docs/reference/config.md)

### Contribute

- [Agent context](docs/agent-context.md)
- [Project posture](docs/project-posture.md)
- [Development guide](docs/guides/development.md)
- [Core layering](docs/architecture/core-layering.md)
- [Framework vision](docs/strategy/framework-vision.md)

## Development

```bash
git clone https://github.com/roackb2/heddle.git
cd heddle
yarn install
yarn build
yarn test
```

`yarn test` runs the default unit and integration suites. Browser integration
coverage lives under `src/__tests__/browser-integration`.

## License

Heddle is licensed under the MIT License. See [LICENSE](LICENSE).
