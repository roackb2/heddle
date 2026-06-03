import dayjs from 'dayjs';
import type { ControlPlaneHeartbeatTaskView } from '@/client-shared/api/types.js';
import { truncate } from '@/core/utils/text.js';
import type { ParsedHeartbeatArgs } from './args.js';
import { booleanFlag, parsePositiveInt, stringFlag } from './args.js';
import { formatDurationMs, parseDurationMs } from './duration.js';
import type { HeartbeatCliContext } from './types.js';

export async function runHeartbeatTaskCli(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  switch (parsed.subcommand) {
    case 'add':
      await addHeartbeatTask(parsed, context);
      return;
    case 'list':
    case undefined:
      await listHeartbeatTasks(context);
      return;
    case 'enable':
      await setHeartbeatTaskEnabled(parsed, context, true);
      return;
    case 'disable':
      await setHeartbeatTaskEnabled(parsed, context, false);
      return;
    case 'show':
      await showHeartbeatTask(parsed, context);
      return;
    default:
      throw new Error(`Unknown heartbeat task command: ${parsed.subcommand}`);
  }
}

async function addHeartbeatTask(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.rest[0];
  const taskText = stringFlag(parsed.flags, 'task') ?? stringFlag(parsed.flags, 'goal') ?? parsed.rest.slice(id ? 1 : 0).join(' ');
  if (!id || !taskText.trim()) {
    throw new Error('Usage: heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m]');
  }

  const result = await context.client.controlPlane.heartbeatTaskCreate.mutate({
    workspaceId: context.workspaceId,
    id,
    name: stringFlag(parsed.flags, 'name'),
    task: taskText.trim(),
    enabled: !booleanFlag(parsed.flags, 'disabled'),
    continuationMode: parseContinuationMode(stringFlag(parsed.flags, 'continuation')),
    intervalMs: parseDurationMs(stringFlag(parsed.flags, 'every') ?? stringFlag(parsed.flags, 'interval') ?? '1h'),
    defer: booleanFlag(parsed.flags, 'defer'),
    model: stringFlag(parsed.flags, 'model') ?? context.options.model,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? context.options.maxSteps,
    searchIgnoreDirs: context.options.searchIgnoreDirs,
    systemContext: context.options.systemContext,
  });

  process.stdout.write(`Saved heartbeat task ${result.task.taskId} (${formatDurationMs(result.task.schedule.intervalMs)} interval)\n`);
}

async function listHeartbeatTasks(context: HeartbeatCliContext) {
  const { tasks } = await context.client.controlPlane.heartbeatTasks.query({
    workspaceId: context.workspaceId,
  });
  if (!tasks.length) {
    process.stdout.write('No heartbeat tasks found.\n');
    return;
  }

  process.stdout.write(`${tasks.map(formatTaskListItem).join('\n\n')}\n`);
}

async function setHeartbeatTaskEnabled(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
  enabled: boolean,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.rest[0];
  if (!id) {
    throw new Error(`Usage: heddle heartbeat task ${enabled ? 'enable' : 'disable'} <id>`);
  }

  await (
    enabled ?
      context.client.controlPlane.heartbeatTaskEnable.mutate({ workspaceId: context.workspaceId, taskId: id })
    : context.client.controlPlane.heartbeatTaskDisable.mutate({ workspaceId: context.workspaceId, taskId: id })
  );
  process.stdout.write(`${enabled ? 'Enabled' : 'Disabled'} heartbeat task ${id}\n`);
}

async function showHeartbeatTask(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.rest[0];
  if (!id) {
    throw new Error('Usage: heddle heartbeat task show <id>');
  }

  const { task } = await context.client.controlPlane.heartbeatTask.query({
    workspaceId: context.workspaceId,
    taskId: id,
    runLimit: 3,
  });
  process.stdout.write(formatTaskDetail(task));
}

export function formatTaskListItem(task: ControlPlaneHeartbeatTaskView): string {
  const state = task.state;
  return [
    `Task ${task.taskId}`,
    task.name ? `  name: ${task.name}` : undefined,
    `  state: ${task.enabled ? 'enabled' : 'disabled'}, ${state.status}`,
    `  schedule: every ${formatDurationMs(task.schedule.intervalMs)}, next ${formatTimestamp(task.schedule.nextRunAt)}`,
    `  model: ${task.runtime?.model ?? 'default'}`,
    `  prompt: ${truncate(firstTextLine(task.task), 140)}`,
    state.progress ? `  progress: ${truncate(state.progress, 140)}` : undefined,
    state.runId ? `  run: ${state.runId} (${state.resumable === false ? 'not resumable' : 'resumable'}, checkpoint ${state.loadedCheckpoint ? 'loaded' : 'not loaded'})` : undefined,
    state.result ? `  last: ${state.result.decision}, ${state.result.outcome} at ${formatTimestamp(state.runAt)}` : undefined,
    state.result?.usage ? `  usage: ${formatUsage(state.result.usage)}` : undefined,
    state.error ? `  error: ${truncate(state.error, 140)}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatTaskDetail(task: ControlPlaneHeartbeatTaskView): string {
  const state = task.state;
  return [
    `Heartbeat task ${task.taskId}`,
    '',
    formatSection('Overview', [
      task.name ? `name: ${task.name}` : undefined,
      `state: ${task.enabled ? 'enabled' : 'disabled'}, ${state.status}`,
      `model: ${task.runtime?.model ?? 'default'}`,
    ]),
    formatSection('Schedule', [
      `every: ${formatDurationMs(task.schedule.intervalMs)}`,
      `next: ${formatTimestamp(task.schedule.nextRunAt)}`,
    ]),
    formatSection('Last Run', [
      state.result ? `decision: ${state.result.decision}` : 'decision: none',
      state.result ? `outcome: ${state.result.outcome}` : undefined,
      state.runAt ? `time: ${formatTimestamp(state.runAt)}` : undefined,
      state.runId ? `run id: ${state.runId}` : undefined,
      state.runId ? `resumable: ${state.resumable === false ? 'no' : 'yes'}` : undefined,
      state.runId ? `checkpoint: ${state.loadedCheckpoint ? 'loaded' : 'not loaded'}` : undefined,
      state.result?.usage ? `usage: ${formatUsage(state.result.usage)}` : undefined,
      state.progress ? `progress: ${state.progress}` : undefined,
      state.error ? `error: ${state.error}` : undefined,
    ]),
    formatSection('Task', [task.task]),
    state.result ? formatSection('Last Summary', [state.result.summary]) : undefined,
    '',
  ].filter((line): line is string => Boolean(line)).join('\n\n');
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return 'now';
  }
  const timestamp = dayjs(value);
  return timestamp.isValid() ? timestamp.format('YYYY-MM-DD HH:mm:ss') : value;
}

function formatUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests?: number;
}): string {
  return [
    `input ${usage.inputTokens}`,
    `output ${usage.outputTokens}`,
    `total ${usage.totalTokens}`,
    usage.requests === undefined ? undefined : `requests ${usage.requests}`,
  ].filter((part): part is string => Boolean(part)).join(', ');
}

function firstTextLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
}

function formatSection(title: string, lines: Array<string | undefined>): string | undefined {
  const body = lines.filter((line): line is string => Boolean(line));
  if (!body.length) {
    return undefined;
  }
  return [`${title}:`, ...body.map((line) => indentBlock(line))].join('\n');
}

function indentBlock(value: string): string {
  return value.split(/\r?\n/).map((line) => `  ${line}`).join('\n');
}

function parseContinuationMode(value: string | undefined): 'operator' | 'agent' | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'operator' || value === 'agent') {
    return value;
  }
  throw new Error('Usage: --continuation <operator|agent>');
}
