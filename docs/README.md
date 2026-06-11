# Heddle Documentation

Heddle is a terminal coding agent runtime and CLI for real project work. This
docs hub is organized so humans and coding agents can read the minimum useful
context first, then branch to deeper material only when needed.

## Start Here

If you are new to Heddle, begin with:

- [Root README](../README.md) for installation and product overview
- [Runtime host model](guides/runtime-host-model.md) for how terminal chat, daemon mode, workspace identity, and the shared control-plane server fit together
- [Chat and sessions](guides/chat-and-sessions.md) for the core interactive workflow
- [Agent Skills](guides/agent-skills.md) for opt-in reusable agent workflows and skill activation
- [MCP integrations](reference/mcp.md) for connecting Heddle to ecosystem MCP servers
- [Knowledge persistence](guides/knowledge-persistence.md) for how Heddle learns durable workspace knowledge while it works
- [Control plane](guides/control-plane.md) for the browser UI, workspace switching, session review, task workbench, and browser composer
- [Providers and models](reference/providers-and-models.md) for OpenAI, Anthropic, and local Ollama setup
- [Heartbeat](guides/heartbeat.md) for scheduled/background task workflows
- [CLI reference](reference/cli.md) for command lookup

## Agent Reading Priority

Coding agents should not read every document by default.

Always read:

1. [Agent context](agent-context.md)
2. [Project posture](project-posture.md)
3. The live implementation path and nearby tests for the requested change

Read only when needed:

- `guides/` for user/operator workflows
- `reference/` for command, config, provider, and tool details
- `architecture/` for agreed code boundaries and layering
- `strategy/` for long-term direction and product tradeoffs
- `evaluation/` for eval prompts and behavior-checking workflows
- `releases/` for release notes and release process

## Guides

Task-oriented guides:

- [Chat and sessions](guides/chat-and-sessions.md)
- [Agent Skills](guides/agent-skills.md)
- [Runtime host model](guides/runtime-host-model.md)
- [Control plane](guides/control-plane.md)
- [Knowledge persistence](guides/knowledge-persistence.md)
- [Semantic drift](guides/semantic-drift.md)
- [Heartbeat](guides/heartbeat.md)
- [Programmatic use](guides/programmatic-use.md)
- [Development and contributing](guides/development.md)
- [Debugging](guides/debugging.md)
- [Release convention](releases/README.md)

## Reference

Reference material for commands, configuration, and runtime behavior:

- [CLI reference](reference/cli.md)
- [Capabilities and tools](reference/capabilities.md)
- [MCP integrations](reference/mcp.md)
- [Providers and models](reference/providers-and-models.md)
- [Project config](reference/config.md)

## Architecture

Contributor-facing architecture boundaries:

- [Core Layering](architecture/core-layering.md)
- [Chat Layering](architecture/chat-layering.md)
- [Live Events](architecture/live-events.md)

## Project Context

Public orientation and long-term project direction:

- [Project Posture](project-posture.md)
- [Agent context](agent-context.md)

Longer-term strategy:

- [Project Purpose](strategy/project-purpose.md)
- [Framework Vision](strategy/framework-vision.md)
- [Coding Agent Roadmap](strategy/coding-agent-roadmap.md)

Evaluation:

- [Eval prompts](evaluation/eval-prompts.md)

## Suggested Reading Paths

### I want to use Heddle in a project

1. [README](../README.md)
2. [Chat and sessions](guides/chat-and-sessions.md)
3. [Agent Skills](guides/agent-skills.md)
4. [MCP integrations](reference/mcp.md)
5. [Knowledge persistence](guides/knowledge-persistence.md)
6. [Providers and models](reference/providers-and-models.md)
7. [Project config](reference/config.md)

### I want the browser UI and remote oversight

1. [Runtime host model](guides/runtime-host-model.md)
2. [Control plane](guides/control-plane.md)
3. [CLI reference](reference/cli.md)
4. [Heartbeat](guides/heartbeat.md)

### I want scheduled or background agent work

1. [Heartbeat](guides/heartbeat.md)
2. [Control plane](guides/control-plane.md)
3. [Programmatic use](guides/programmatic-use.md)

### I want to switch between local projects

1. [Control plane](guides/control-plane.md)
2. [Runtime host model](guides/runtime-host-model.md)
3. [CLI reference](reference/cli.md)

### I want to build on Heddle programmatically

1. [Programmatic use](guides/programmatic-use.md) for the conversation engine alpha, persisted sessions, and turn submission
2. [Capabilities and tools](reference/capabilities.md)
3. [Providers and models](reference/providers-and-models.md)

### I want to contribute or develop locally

1. [Agent context](agent-context.md)
2. [Project Posture](project-posture.md)
3. [Development and contributing](guides/development.md)
4. [CLI reference](reference/cli.md)
5. [Framework Vision](strategy/framework-vision.md) only for strategic context
6. [Core Layering](architecture/core-layering.md) when changing core boundaries

### I want to prepare a release

1. [Release convention](releases/README.md)
2. [Development and contributing](guides/development.md)
3. [CLI reference](reference/cli.md)
