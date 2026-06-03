import dayjs from 'dayjs';
import type { ControlPlaneHeartbeatRunView } from '@/client-shared/api/types.js';
import { truncate } from '@/core/utils/text.js';
import type { ParsedHeartbeatArgs } from './args.js';
import { parsePositiveInt, stringFlag } from './args.js';
import { firstLine, stripHeartbeatDecisionLine } from './summary.js';
import type { HeartbeatCliContext } from './types.js';

export async function runHeartbeatRunsCli(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  switch (parsed.subcommand) {
    case 'list':
    case undefined:
      await listHeartbeatRuns(parsed, context);
      return;
    case 'show':
      await showHeartbeatRun(parsed, context);
      return;
    default:
      throw new Error(`Unknown heartbeat runs command: ${parsed.subcommand}`);
  }
}

async function listHeartbeatRuns(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  const taskId = stringFlag(parsed.flags, 'task') ?? parsed.rest[0];
  const limit = parsePositiveInt(stringFlag(parsed.flags, 'limit')) ?? 10;
  const { runs } = await context.client.controlPlane.heartbeatRuns.query({
    workspaceId: context.workspaceId,
    taskId,
    limit,
  });
  if (!runs.length) {
    process.stdout.write(taskId ? `No heartbeat runs found for task ${taskId}.\n` : 'No heartbeat runs found.\n');
    return;
  }

  process.stdout.write(`${runs.map(formatRunListItem).join('\n\n')}\n`);
}

async function showHeartbeatRun(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  const id = parsed.rest[0] ?? stringFlag(parsed.flags, 'id') ?? 'latest';
  const taskId = stringFlag(parsed.flags, 'task');
  const run =
    taskId ?
      (await context.client.controlPlane.heartbeatRun.query({
        workspaceId: context.workspaceId,
        taskId,
        runId: id,
      })).run
    : await findHeartbeatRunById(context, id);

  if (!run || (taskId && run.taskId !== taskId)) {
    throw new Error(taskId ? `Heartbeat run not found for task ${taskId}: ${id}` : `Heartbeat run not found: ${id}`);
  }

  process.stdout.write(formatRunDetail(run));
}

export function formatRunListItem(run: ControlPlaneHeartbeatRunView): string {
  return [
    `Run ${run.runId}`,
    `  task: ${run.taskId}`,
    `  result: ${run.result.decision}, ${run.result.outcome}`,
    `  finished: ${formatTimestamp(run.createdAt)}`,
    run.result.usage ? `  usage: ${formatUsage(run.result.usage)}` : undefined,
    `  summary: ${truncate(firstLine(stripHeartbeatDecisionLine(run.result.summary)), 140)}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatRunDetail(run: ControlPlaneHeartbeatRunView): string {
  return [
    `Heartbeat run ${run.runId}`,
    '',
    formatSection('Overview', [
      `task: ${run.taskId}`,
      `result: ${run.result.decision}, ${run.result.outcome}`,
      `finished: ${formatTimestamp(run.createdAt)}`,
      `checkpoint: ${run.loadedCheckpoint ? 'loaded' : 'not loaded'}`,
      run.result.usage ? `usage: ${formatUsage(run.result.usage)}` : undefined,
    ]),
    formatSection('Task', [run.task.task]),
    formatSection('Summary', [
      stripHeartbeatDecisionLine(run.result.summary).trim() || run.result.summary.trim(),
    ]),
    '',
  ].filter((line): line is string => Boolean(line)).join('\n\n');
}

function formatTimestamp(value: string): string {
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

async function findHeartbeatRunById(
  context: HeartbeatCliContext,
  id: string,
): Promise<ControlPlaneHeartbeatRunView | null> {
  const { runs } = await context.client.controlPlane.heartbeatRuns.query({
    workspaceId: context.workspaceId,
    limit: 100,
  });
  if (id === 'latest') {
    return runs[0] ?? null;
  }

  return runs.find((run) => run.id === id || run.runId === id) ?? null;
}
