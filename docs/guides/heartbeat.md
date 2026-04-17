# Heartbeat

Heddle exposes `runAgentHeartbeat` for autonomous, scheduler-driven agent work.

Heartbeat is not interactive chat mode. It is a host/runtime primitive for systems that want to wake an agent periodically, let it work within budget and approval limits, checkpoint the result, and decide what should happen next.

## Heartbeat Wake Cycle

A heartbeat wake cycle:

- loads a durable task plus an optional checkpoint
- resumes prior transcript state if available
- lets the agent do bounded useful work without a human prompt
- checkpoints the new state
- returns a decision: `continue`, `pause`, `complete`, or `escalate`

## CLI Usage

The installed CLI exposes the local heartbeat scheduler:

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

Adding a task only saves scheduler state; it does not start a background process. Stop a foreground scheduler with `Ctrl+C`, or pause a task with:

```bash
heddle heartbeat task disable repo-gardener
```

## Programmatic Scheduler Pieces

For repeated wake cycles, Heddle also exposes a local-first scheduler core:

- `runDueHeartbeatTasks`
- `runHeartbeatScheduler`
- `createFileHeartbeatTaskStore`

Cron, launchd, systemd, hosted queues, and Lucid-style services should be treated as hosts around this API, not as Heddle's internal scheduler model.

## Examples

Try a small local heartbeat example:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:heartbeat
```

Try the local scheduler API with a real LLM:

```bash
export OPENAI_API_KEY=your_key_here
yarn example:heartbeat-scheduler
```

## Host Notes

Heartbeat uses a larger default step budget than ordinary short chat runs so a wake cycle has room to inspect, act, and checkpoint. Hosts can still pass `maxSteps` when they need stricter control.

The built-in CLI heartbeat runner is intentionally conservative: it has no live approval UI, so approval-gated file edits and mutation shell commands are denied with a clear blocker. It is useful today for recurring inspection, summaries, memory-note updates, and escalation reports.

## See Also

- [Programmatic use](programmatic-use.md)
- [CLI reference](../reference/cli.md)
- [Control plane](control-plane.md)
