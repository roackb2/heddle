import type { ParsedHeartbeatArgs } from './args.js';
import { parsePositiveInt, stringFlag } from './args.js';
import { firstLine, stripHeartbeatDecisionLine } from './summary.js';
import type { HeartbeatCliStore } from './types.js';

export async function runHeartbeatRunsCli(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
) {
  switch (parsed.subcommand) {
    case 'list':
    case undefined:
      await listHeartbeatRuns(parsed, store);
      return;
    case 'show':
      await showHeartbeatRun(parsed, store);
      return;
    default:
      throw new Error(`Unknown heartbeat runs command: ${parsed.subcommand}`);
  }
}

async function listHeartbeatRuns(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
) {
  const taskId = stringFlag(parsed.flags, 'task') ?? parsed.rest[0];
  const limit = parsePositiveInt(stringFlag(parsed.flags, 'limit')) ?? 10;
  const runs = await store.listRunRecords?.({ taskId, limit });
  if (!runs?.length) {
    process.stdout.write(taskId ? `No heartbeat runs found for task ${taskId}.\n` : 'No heartbeat runs found.\n');
    return;
  }

  for (const run of runs) {
    const { result } = run.record;
    process.stdout.write([
      `${run.id}`,
      `  task=${run.taskId} run=${run.runId} decision=${result.decision} outcome=${result.state.outcome} finished=${run.createdAt}`,
      result.state.usage ? `  usage input=${result.state.usage.inputTokens} output=${result.state.usage.outputTokens} total=${result.state.usage.totalTokens} requests=${result.state.usage.requests}` : undefined,
      `  summary=${firstLine(stripHeartbeatDecisionLine(result.summary))}`,
    ].filter((line): line is string => Boolean(line)).join('\n') + '\n');
  }
}

async function showHeartbeatRun(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
) {
  const id = parsed.rest[0] ?? stringFlag(parsed.flags, 'id') ?? 'latest';
  const taskId = stringFlag(parsed.flags, 'task');
  const run =
    id === 'latest' ?
      (await store.listRunRecords?.({ taskId, limit: 1 }))?.[0]
    : await store.loadRunRecord?.(id);

  if (!run || (taskId && run.taskId !== taskId)) {
    throw new Error(taskId ? `Heartbeat run not found for task ${taskId}: ${id}` : `Heartbeat run not found: ${id}`);
  }

  const { result, loadedCheckpoint } = run.record;
  process.stdout.write([
    `Heartbeat run ${run.id}`,
    `task=${run.taskId} run=${run.runId} loadedCheckpoint=${loadedCheckpoint}`,
    `decision=${result.decision} outcome=${result.state.outcome} finished=${run.createdAt}`,
    result.state.usage ? `usage input=${result.state.usage.inputTokens} output=${result.state.usage.outputTokens} total=${result.state.usage.totalTokens} requests=${result.state.usage.requests}` : undefined,
    '',
    'Task:',
    run.record.task.task,
    '',
    'Summary:',
    stripHeartbeatDecisionLine(result.summary).trim() || result.summary.trim(),
    '',
  ].filter((line): line is string => line !== undefined).join('\n'));
}
