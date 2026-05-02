import { matchesExactSlashCommand, matchesSlashCommandPrefix } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type {
  HeartbeatTask,
  HeartbeatTaskRunRecordEntry,
} from '../../../../runtime/heartbeat-task-store.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';

export function createHeartbeatSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'heartbeat',
    hints: [
      { command: '/heartbeat tasks', description: 'list heartbeat tasks' },
      { command: '/heartbeat task <id>', description: 'show one heartbeat task' },
      { command: '/heartbeat runs [task]', description: 'list recent heartbeat runs' },
      { command: '/heartbeat run <task> [run-id|latest]', description: 'show one heartbeat run' },
      { command: '/heartbeat continue <task> [run-id|latest]', description: 'continue in chat from a heartbeat run summary' },
    ],
    commands: [
      {
        id: 'heartbeat.tasks',
        syntax: '/heartbeat tasks',
        description: 'list heartbeat tasks',
        match: matchesExactSlashCommand('/heartbeat tasks'),
        run: (context) => listHeartbeatTasksMessage(context),
      },
      {
        id: 'heartbeat.task',
        syntax: '/heartbeat task <id>',
        description: 'show one heartbeat task',
        match: matchesRequiredHeartbeatArgument('/heartbeat task'),
        run: (context, input) => showHeartbeatTask(context, argumentAfterPrefix(input, '/heartbeat task')),
      },
      {
        id: 'heartbeat.runs.list',
        syntax: '/heartbeat runs [task]',
        description: 'list recent heartbeat runs',
        match: matchesSlashCommandPrefix('/heartbeat runs'),
        run: (context, input) => listHeartbeatRunsMessage(context, argumentAfterPrefix(input, '/heartbeat runs')),
      },
      {
        id: 'heartbeat.run.show',
        syntax: '/heartbeat run <task> [run-id|latest]',
        description: 'show one heartbeat run',
        match: matchesRequiredHeartbeatArgument('/heartbeat run'),
        run: (context, input) => showHeartbeatRun(context, argumentAfterPrefix(input, '/heartbeat run')),
      },
      {
        id: 'heartbeat.continue',
        syntax: '/heartbeat continue <task> [run-id|latest]',
        description: 'continue in chat from a heartbeat run summary',
        match: matchesRequiredHeartbeatArgument('/heartbeat continue'),
        run: (context, input) => continueHeartbeatRun(context, argumentAfterPrefix(input, '/heartbeat continue')),
      },
    ],
  };
}

export async function listHeartbeatTasksMessage(
  context: Pick<SlashCommandExecutionContext, 'heartbeat'>,
): Promise<SlashCommandResult> {
  const tasks = await context.heartbeat.listTasks();
  if (!tasks.length) {
    return slashMessageResult('No heartbeat tasks found.');
  }

  return slashMessageResult(tasks.map(formatHeartbeatTaskListItem).join('\n'));
}

export async function listHeartbeatRunsMessage(
  context: Pick<SlashCommandExecutionContext, 'heartbeat'>,
  taskId: string,
): Promise<SlashCommandResult> {
  const trimmedTaskId = taskId.trim();
  const runs = await context.heartbeat.listRunRecords({
    taskId: trimmedTaskId || undefined,
    limit: 10,
  });
  if (!runs.length) {
    return slashMessageResult(trimmedTaskId ? `No heartbeat runs found for task ${trimmedTaskId}.` : 'No heartbeat runs found.');
  }

  return slashMessageResult(runs.map(formatHeartbeatRunListItem).join('\n'));
}

export function formatHeartbeatTask(task: HeartbeatTask): string {
  return [
    `${task.enabled ? 'enabled' : 'disabled'} ${task.id}`,
    `status=${task.status ?? 'idle'} every=${formatInterval(task.intervalMs)} next=${task.nextRunAt ?? 'none'} model=${task.model ?? 'default'}`,
    '',
    'Task:',
    task.task,
    '',
    task.lastProgress ? `Progress: ${task.lastProgress}` : undefined,
    `Last decision: ${task.lastDecision ?? 'none'}`,
    task.lastOutcome ? `Last outcome: ${task.lastOutcome}` : undefined,
    task.lastRunAt ? `Last run: ${task.lastRunAt}` : undefined,
    task.lastRunId ? `Last run id: ${task.lastRunId}` : undefined,
    task.lastRunId ? `Resumable: ${task.resumable === false ? 'no' : 'yes'}` : undefined,
    task.lastRunId ? `Loaded checkpoint: ${task.lastLoadedCheckpoint ? 'yes' : 'no'}` : undefined,
    task.lastUsage ? `Usage: input=${task.lastUsage.inputTokens} output=${task.lastUsage.outputTokens} total=${task.lastUsage.totalTokens} requests=${task.lastUsage.requests}` : undefined,
    task.lastError ? `Last error: ${task.lastError}` : undefined,
    task.lastSummary ? ['', 'Last summary:', stripHeartbeatDecisionLine(task.lastSummary).trim() || task.lastSummary.trim()].join('\n') : undefined,
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function formatHeartbeatRun(run: HeartbeatTaskRunRecordEntry): string {
  const result = run.record.result;
  return [
    `Heartbeat run ${run.id}`,
    `task=${run.taskId} run=${run.runId} loadedCheckpoint=${run.record.loadedCheckpoint}`,
    `decision=${result.decision} outcome=${result.state.outcome} finished=${run.createdAt}`,
    result.state.usage ? `usage input=${result.state.usage.inputTokens} output=${result.state.usage.outputTokens} total=${result.state.usage.totalTokens} requests=${result.state.usage.requests}` : undefined,
    '',
    'Task:',
    run.record.task.task,
    '',
    'Summary:',
    stripHeartbeatDecisionLine(result.summary).trim() || result.summary.trim(),
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function buildHeartbeatContinuationPrompt(run: HeartbeatTaskRunRecordEntry): string {
  const result = run.record.result;
  return [
    'Continue from this heartbeat run context.',
    '',
    `Heartbeat task id: ${run.taskId}`,
    `Heartbeat run id: ${run.runId}`,
    `Decision: ${result.decision}`,
    `Outcome: ${result.state.outcome}`,
    `Finished at: ${run.createdAt}`,
    `Loaded checkpoint: ${run.record.loadedCheckpoint}`,
    `Task status: ${run.record.task.status ?? 'unknown'}`,
    run.record.task.lastProgress ? `Task progress: ${run.record.task.lastProgress}` : undefined,
    run.record.task.resumable === false ? 'Resumable: no' : 'Resumable: yes',
    '',
    'Durable task:',
    run.record.task.task,
    '',
    'Heartbeat summary:',
    stripHeartbeatDecisionLine(result.summary).trim() || result.summary.trim(),
    '',
    'Treat the heartbeat summary as trusted background context from prior autonomous work. Help the user continue from there.',
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function stripHeartbeatDecisionLine(summary: string): string {
  return summary.replace(/\n?\s*HEARTBEAT_DECISION:\s*(continue|pause|complete|escalate)\s*$/i, '');
}

function matchesRequiredHeartbeatArgument(prefix: string): (input: { raw: string }) => boolean {
  return (input) => input.raw.startsWith(`${prefix} `);
}

async function showHeartbeatTask(
  context: Pick<SlashCommandExecutionContext, 'heartbeat'>,
  value: string,
): Promise<SlashCommandResult> {
  const taskId = value.trim();
  const tasks = await context.heartbeat.listTasks();
  const task = tasks.find((candidate) => candidate.id === taskId);
  return task ? slashMessageResult(formatHeartbeatTask(task)) : slashMessageResult(`Heartbeat task not found: ${taskId}`);
}

async function showHeartbeatRun(
  context: Pick<SlashCommandExecutionContext, 'heartbeat'>,
  value: string,
): Promise<SlashCommandResult> {
  const request = parseHeartbeatRunRequest(value);
  const run = await resolveHeartbeatRun(context, request);
  return run ? slashMessageResult(formatHeartbeatRun(run)) : slashMessageResult(`Heartbeat run not found for task ${request.taskId}: ${request.runRef}`);
}

async function continueHeartbeatRun(
  context: Pick<SlashCommandExecutionContext, 'heartbeat'>,
  value: string,
): Promise<SlashCommandResult> {
  const request = parseHeartbeatRunRequest(value);
  const run = await resolveHeartbeatRun(context, request);
  if (!run) {
    return slashMessageResult(`Heartbeat run not found for task ${request.taskId}: ${request.runRef}`);
  }

  return {
    handled: true,
    kind: 'execute',
    displayText: `Continue heartbeat ${request.taskId}`,
    message: `Loaded heartbeat run ${run.id} for task ${request.taskId}. Continuing from that background summary.`,
    prompt: buildHeartbeatContinuationPrompt(run),
  };
}

async function resolveHeartbeatRun(
  context: Pick<SlashCommandExecutionContext, 'heartbeat'>,
  request: { taskId: string; runRef: string },
): Promise<HeartbeatTaskRunRecordEntry | undefined> {
  if (request.runRef === 'latest') {
    return (await context.heartbeat.listRunRecords({ taskId: request.taskId, limit: 1 }))[0];
  }

  const run = await context.heartbeat.loadRunRecord(request.runRef);
  return run?.taskId === request.taskId ? run : undefined;
}

function parseHeartbeatRunRequest(value: string): { taskId: string; runRef: string } {
  const [taskId = '', runRef = 'latest'] = value.split(/\s+/, 2);
  return { taskId, runRef };
}

function formatHeartbeatTaskListItem(task: HeartbeatTask): string {
  const next = task.nextRunAt ?? 'none';
  const decision = task.lastDecision ?? 'none';
  return [
    `${task.enabled ? 'enabled' : 'disabled'} ${task.id}`,
    `  status=${task.status ?? 'idle'} every=${formatInterval(task.intervalMs)} next=${next} decision=${decision}`,
    task.lastProgress ? `  progress=${task.lastProgress}` : undefined,
  ].filter((line): line is string => line !== undefined).join('\n');
}

function formatHeartbeatRunListItem(run: HeartbeatTaskRunRecordEntry): string {
  const summary = firstLine(stripHeartbeatDecisionLine(run.record.result.summary));
  return `${run.id}\n  task=${run.taskId} decision=${run.record.result.decision} outcome=${run.record.result.state.outcome} finished=${run.createdAt}\n  summary=${summary}`;
}

function firstLine(value: string): string {
  const line = value.trim().split('\n').find((candidate) => candidate.trim());
  return line?.trim() ?? '';
}

function formatInterval(intervalMs: number): string {
  if (intervalMs % (24 * 60 * 60_000) === 0) return `${intervalMs / (24 * 60 * 60_000)}d`;
  if (intervalMs % (60 * 60_000) === 0) return `${intervalMs / (60 * 60_000)}h`;
  if (intervalMs % 60_000 === 0) return `${intervalMs / 60_000}m`;
  if (intervalMs % 1_000 === 0) return `${intervalMs / 1_000}s`;
  return `${intervalMs}ms`;
}
