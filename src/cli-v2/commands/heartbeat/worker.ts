import type { ParsedHeartbeatArgs } from './args.js';
import { booleanFlag, parsePositiveInt, stringFlag } from './args.js';
import { formatDurationMs, parseDurationMs } from './duration.js';
import type { HeartbeatCliContext } from './types.js';

const DEFAULT_HEARTBEAT_TASK_ID = 'default';
const DEFAULT_HEARTBEAT_TASK = [
  'Run a periodic autonomous heartbeat for this workspace.',
  'Read HEARTBEAT.md if it exists, inspect recent project state when useful, continue safe low-risk maintenance work, and escalate when human input is needed.',
].join(' ');

export async function runHeartbeatWorkerCli(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  const taskId = stringFlag(parsed.flags, 'task') ?? parsed.rest[0];
  if (taskId) {
    const result = await context.client.controlPlane.heartbeatTaskRunNow.mutate({
      workspaceId: context.workspaceId,
      taskId,
      model: stringFlag(parsed.flags, 'model') ?? context.options.model,
      maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? context.options.maxSteps,
      preferApiKey: context.options.preferApiKey,
      searchIgnoreDirs: context.options.searchIgnoreDirs,
      systemContext: context.options.systemContext,
    });
    process.stdout.write(`accepted=${result.accepted} task=${result.task.taskId} status=${result.task.state.status}\n`);
    return;
  }

  const result = await context.client.controlPlane.heartbeatRunDueTasks.mutate({
    workspaceId: context.workspaceId,
    model: stringFlag(parsed.flags, 'model') ?? context.options.model,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? context.options.maxSteps,
    preferApiKey: context.options.preferApiKey,
    searchIgnoreDirs: context.options.searchIgnoreDirs,
    systemContext: context.options.systemContext,
  });
  process.stdout.write(`checked=${result.checked} ran=${result.ran} failed=${result.failed}\n`);
}

export async function startHeartbeatCli(
  parsed: ParsedHeartbeatArgs,
  context: HeartbeatCliContext,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.subcommand ?? DEFAULT_HEARTBEAT_TASK_ID;
  const intervalMs = parseDurationMs(stringFlag(parsed.flags, 'every') ?? stringFlag(parsed.flags, 'interval') ?? '30m');
  const pollIntervalMs = parseDurationMs(stringFlag(parsed.flags, 'poll') ?? '60s');
  const existing = await findExistingTask(context, id);
  const taskText = stringFlag(parsed.flags, 'task') ?? stringFlag(parsed.flags, 'goal') ?? existing?.task ?? DEFAULT_HEARTBEAT_TASK;
  const task =
    existing ?
      (await context.client.controlPlane.heartbeatTaskUpdate.mutate({
        workspaceId: context.workspaceId,
        taskId: id,
        name: stringFlag(parsed.flags, 'name') ?? existing.name,
        task: taskText.trim(),
        enabled: true,
        intervalMs,
        model: stringFlag(parsed.flags, 'model') ?? existing.runtime?.model ?? context.options.model,
        maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? existing.runtime?.maxSteps ?? context.options.maxSteps,
        searchIgnoreDirs: context.options.searchIgnoreDirs,
        systemContext: context.options.systemContext,
      })).task
    : (await context.client.controlPlane.heartbeatTaskCreate.mutate({
      workspaceId: context.workspaceId,
      id,
      name: stringFlag(parsed.flags, 'name'),
      task: taskText.trim(),
      enabled: true,
      intervalMs,
      defer: booleanFlag(parsed.flags, 'defer'),
      model: stringFlag(parsed.flags, 'model') ?? context.options.model,
      maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? context.options.maxSteps,
      searchIgnoreDirs: context.options.searchIgnoreDirs,
      systemContext: context.options.systemContext,
    })).task;

  if (booleanFlag(parsed.flags, 'once')) {
    await runHeartbeatWorkerCli({
      command: 'run',
      subcommand: undefined,
      rest: [],
      flags: {
        ...parsed.flags,
        task: id,
      },
    }, context);
    return;
  }

  process.stdout.write([
    `Heartbeat scheduler is server-backed for workspace ${context.workspaceId}.`,
    `task=${task.taskId} status=${task.state.status} every=${formatDurationMs(intervalMs)} poll=${formatDurationMs(pollIntervalMs)}`,
    'Use `heddle daemon` for a standalone long-running server, or keep this embedded command running.',
  ].join('\n') + '\n');
}

async function findExistingTask(
  context: HeartbeatCliContext,
  taskId: string,
) {
  const { tasks } = await context.client.controlPlane.heartbeatTasks.query({
    workspaceId: context.workspaceId,
  });
  return tasks.find((task) => task.taskId === taskId);
}
