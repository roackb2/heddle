import type { HeartbeatTask } from '../../index.js';
import type { ParsedHeartbeatArgs } from './args.js';
import { booleanFlag, parsePositiveInt, stringFlag } from './args.js';
import { formatDurationMs, parseDurationMs } from './duration.js';
import type { HeartbeatCliOptions, HeartbeatCliStore } from './types.js';

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
  const task: HeartbeatTask = {
    id,
    name: stringFlag(parsed.flags, 'name'),
    task: taskText.trim(),
    enabled: !booleanFlag(parsed.flags, 'disabled'),
    intervalMs,
    nextRunAt: booleanFlag(parsed.flags, 'defer') ? new Date(now.getTime() + intervalMs).toISOString() : new Date(now.getTime() - 1_000).toISOString(),
    model: stringFlag(parsed.flags, 'model') ?? options.model,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? options.maxSteps,
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    stateDir: options.stateDir,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
  };

  await store.saveTask(task);
  process.stdout.write(`Saved heartbeat task ${task.id} (${formatDurationMs(intervalMs)} interval)\n`);
}

async function listHeartbeatTasks(store: HeartbeatCliStore) {
  const tasks = await store.listTasks();
  if (!tasks.length) {
    process.stdout.write('No heartbeat tasks found.\n');
    return;
  }

  for (const task of tasks) {
    process.stdout.write([
      `${task.enabled ? 'enabled ' : 'disabled'} ${task.id}${task.name ? ` (${task.name})` : ''}`,
      `  status=${task.status ?? 'idle'} every=${formatDurationMs(task.intervalMs)} next=${task.nextRunAt ?? 'now'} model=${task.model ?? 'default'}`,
      `  task=${task.task}`,
      task.lastProgress ? `  progress=${task.lastProgress}` : undefined,
      task.lastRunId ? `  run=${task.lastRunId} resumable=${task.resumable === false ? 'no' : 'yes'} loadedCheckpoint=${task.lastLoadedCheckpoint ? 'yes' : 'no'}` : undefined,
      task.lastUsage ? `  usage input=${task.lastUsage.inputTokens} output=${task.lastUsage.outputTokens} total=${task.lastUsage.totalTokens} requests=${task.lastUsage.requests}` : undefined,
      task.lastDecision ? `  last=${task.lastDecision} outcome=${task.lastOutcome ?? 'unknown'} runAt=${task.lastRunAt ?? 'unknown'}` : undefined,
      task.lastError ? `  error=${task.lastError}` : undefined,
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
    nextRunAt: enabled && !task.nextRunAt ? new Date(Date.now() - 1_000).toISOString() : task.nextRunAt,
    updatedAt: new Date().toISOString(),
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

  process.stdout.write([
    `${task.enabled ? 'enabled ' : 'disabled'} ${task.id}${task.name ? ` (${task.name})` : ''}`,
    `status=${task.status ?? 'idle'} every=${formatDurationMs(task.intervalMs)} next=${task.nextRunAt ?? 'none'} model=${task.model ?? 'default'}`,
    '',
    'Task:',
    task.task,
    '',
    task.lastProgress ? `Progress: ${task.lastProgress}` : undefined,
    task.lastDecision ? `Last decision: ${task.lastDecision}` : 'Last decision: none',
    task.lastOutcome ? `Last outcome: ${task.lastOutcome}` : undefined,
    task.lastRunAt ? `Last run: ${task.lastRunAt}` : undefined,
    task.lastRunId ? `Last run id: ${task.lastRunId}` : undefined,
    task.lastRunId ? `Resumable: ${task.resumable === false ? 'no' : 'yes'}` : undefined,
    task.lastRunId ? `Loaded checkpoint: ${task.lastLoadedCheckpoint ? 'yes' : 'no'}` : undefined,
    task.lastUsage ? `Usage: input=${task.lastUsage.inputTokens} output=${task.lastUsage.outputTokens} total=${task.lastUsage.totalTokens} requests=${task.lastUsage.requests}` : undefined,
    task.lastError ? `Last error: ${task.lastError}` : undefined,
    task.lastSummary ? ['', 'Last summary:', task.lastSummary].join('\n') : undefined,
    '',
  ].filter((line): line is string => Boolean(line)).join('\n'));
}
