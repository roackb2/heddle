import type { HeartbeatTask } from '@/core/heartbeat/index.js';
import { resolve } from 'node:path';
import type { ParsedHeartbeatArgs } from './args.js';
import { booleanFlag, parsePositiveInt, stringFlag } from './args.js';
import { formatDurationMs, parseDurationMs } from './duration.js';
import type { HeartbeatCliOptions, HeartbeatCliStore } from './types.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

export async function runHeartbeatTaskCli(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
  options: HeartbeatCliOptions,
) {
  switch (parsed.subcommand) {
    case 'add':
      await addHeartbeatTask(parsed, store, options);
      return;
    case 'list':
    case undefined:
      await listHeartbeatTasks(store);
      return;
    case 'enable':
      await setHeartbeatTaskEnabled(parsed, store, true);
      return;
    case 'disable':
      await setHeartbeatTaskEnabled(parsed, store, false);
      return;
    case 'show':
      await showHeartbeatTask(parsed, store);
      return;
    default:
      throw new Error(`Unknown heartbeat task command: ${parsed.subcommand}`);
  }
}

async function addHeartbeatTask(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
  options: HeartbeatCliOptions,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.rest[0];
  const taskText = stringFlag(parsed.flags, 'task') ?? stringFlag(parsed.flags, 'goal') ?? parsed.rest.slice(id ? 1 : 0).join(' ');
  if (!id || !taskText.trim()) {
    throw new Error('Usage: heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m]');
  }

  const intervalMs = parseDurationMs(stringFlag(parsed.flags, 'every') ?? stringFlag(parsed.flags, 'interval') ?? '1h');
  const now = new Date();
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateDir = options.stateDir ?? '.heddle';
  const workspace = RuntimeWorkspaceService.resolveContext({
    workspaceRoot,
    stateRoot: resolve(workspaceRoot, stateDir),
  }).activeWorkspace;
  const task: HeartbeatTask = {
    id,
    workspaceId: workspace.id,
    name: stringFlag(parsed.flags, 'name'),
    task: taskText.trim(),
    enabled: !booleanFlag(parsed.flags, 'disabled'),
    schedule: {
      intervalMs,
      nextRunAt: booleanFlag(parsed.flags, 'defer') ? new Date(now.getTime() + intervalMs).toISOString() : new Date(now.getTime() - 1_000).toISOString(),
    },
    runtime: {
      model: stringFlag(parsed.flags, 'model') ?? options.model,
      maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? options.maxSteps,
      workspaceRoot,
      stateDir: options.stateDir,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
    },
  };

  await store.saveTask(task);
  process.stdout.write(`Saved heartbeat task ${task.id} (${formatDurationMs(task.schedule.intervalMs)} interval)\n`);
}

async function listHeartbeatTasks(store: HeartbeatCliStore) {
  const tasks = await store.listTasks();
  if (!tasks.length) {
    process.stdout.write('No heartbeat tasks found.\n');
    return;
  }

  for (const task of tasks) {
    const state = task.state;
    process.stdout.write([
      `${task.enabled ? 'enabled ' : 'disabled'} ${task.id}${task.name ? ` (${task.name})` : ''}`,
      `  status=${state?.status ?? 'idle'} every=${formatDurationMs(task.schedule.intervalMs)} next=${task.schedule.nextRunAt ?? 'now'} model=${task.runtime?.model ?? 'default'}`,
      `  task=${task.task}`,
      state?.progress ? `  progress=${state.progress}` : undefined,
      state?.runId ? `  run=${state.runId} resumable=${state.resumable === false ? 'no' : 'yes'} loadedCheckpoint=${state.loadedCheckpoint ? 'yes' : 'no'}` : undefined,
      state?.result?.state.usage ? `  usage input=${state.result.state.usage.inputTokens} output=${state.result.state.usage.outputTokens} total=${state.result.state.usage.totalTokens} requests=${state.result.state.usage.requests}` : undefined,
      state?.result ? `  last=${state.result.decision} outcome=${state.result.state.outcome} runAt=${state.runAt ?? 'unknown'}` : undefined,
      state?.error ? `  error=${state.error}` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n') + '\n');
  }
}

async function setHeartbeatTaskEnabled(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
  enabled: boolean,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.rest[0];
  if (!id) {
    throw new Error(`Usage: heddle heartbeat task ${enabled ? 'enable' : 'disable'} <id>`);
  }

  const tasks = await store.listTasks();
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new Error(`Heartbeat task not found: ${id}`);
  }

  await store.saveTask({
    ...task,
    enabled,
    schedule: {
      ...task.schedule,
      nextRunAt: enabled && !task.schedule.nextRunAt ? new Date(Date.now() - 1_000).toISOString() : task.schedule.nextRunAt,
    },
    state: {
      ...task.state,
      updatedAt: new Date().toISOString(),
    },
  });
  process.stdout.write(`${enabled ? 'Enabled' : 'Disabled'} heartbeat task ${id}\n`);
}

async function showHeartbeatTask(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.rest[0];
  if (!id) {
    throw new Error('Usage: heddle heartbeat task show <id>');
  }

  const tasks = await store.listTasks();
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new Error(`Heartbeat task not found: ${id}`);
  }

  const state = task.state;
  process.stdout.write([
    `${task.enabled ? 'enabled ' : 'disabled'} ${task.id}${task.name ? ` (${task.name})` : ''}`,
    `status=${state?.status ?? 'idle'} every=${formatDurationMs(task.schedule.intervalMs)} next=${task.schedule.nextRunAt ?? 'none'} model=${task.runtime?.model ?? 'default'}`,
    '',
    'Task:',
    task.task,
    '',
    state?.progress ? `Progress: ${state.progress}` : undefined,
    state?.result ? `Last decision: ${state.result.decision}` : 'Last decision: none',
    state?.result ? `Last outcome: ${state.result.state.outcome}` : undefined,
    state?.runAt ? `Last run: ${state.runAt}` : undefined,
    state?.runId ? `Last run id: ${state.runId}` : undefined,
    state?.runId ? `Resumable: ${state.resumable === false ? 'no' : 'yes'}` : undefined,
    state?.runId ? `Loaded checkpoint: ${state.loadedCheckpoint ? 'yes' : 'no'}` : undefined,
    state?.result?.state.usage ? `Usage: input=${state.result.state.usage.inputTokens} output=${state.result.state.usage.outputTokens} total=${state.result.state.usage.totalTokens} requests=${state.result.state.usage.requests}` : undefined,
    state?.error ? `Last error: ${state.error}` : undefined,
    state?.result ? ['', 'Last summary:', state.result.summary].join('\n') : undefined,
    '',
  ].filter((line): line is string => Boolean(line)).join('\n'));
}
