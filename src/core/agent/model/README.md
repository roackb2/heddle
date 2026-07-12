# Agent Model Turn Service

This folder owns one model request inside an agent run, including streaming,
usage accumulation, retry policy, and safe terminal failure classification.

## Owns

- Calling the configured `LlmAdapter` for the current turn.
- Retrying only model requests that are safe to repeat. Tool calls and whole
  agent runs are never replayed by this service.
- Converting provider status and transport signals into the stable
  host-facing `RunFailure` category.
- Replacing raw provider diagnostics with a stable safe message before the
  value reaches logs, retry traces, or the human-readable run summary.

## Boundary

`AgentModelTurnRetryService` is the single owner of model-failure
classification. Product hosts should branch on `result.failure`, not parse
provider messages or reimplement HTTP-status maps.

The failure contract deliberately contains only a source and code. Raw model
errors are used transiently for structured status and retry detection, then
discarded. Never add credentials, request bodies, response bodies, or provider
messages to the failure or retry contracts: they can flow through traces,
checkpoints, logs, live events, and remote API results.

Provider-specific retry behavior belongs here when it can be derived from
structured adapter errors. Product-specific copy and HTTP/API error mapping
belong in the consuming host.

## Adjacent Owners

- `src/core/llm/` owns provider adapters and their raw response/error behavior.
- `src/core/agent/finish/` owns the final `RunResult` and `run.finished` trace.
- `src/core/runtime/loop/` propagates the finished result into loop state and
  live activity.
- `src/core/chat/engine/turns/` exposes the safe category to programmatic
  conversation hosts.
