import { resolve } from 'node:path';
import {
  createFileHeartbeatTaskStore,
  inferProviderFromModel,
  resolveProviderApiKey,
  runDueHeartbeatTasks,
  runHeartbeatScheduler,
  type AgentLoopEvent,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
} from '../index.js';

export type HeartbeatCliOptions = {
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

type ParsedHeartbeatArgs = {
  command?: string;
  subcommand?: string;
  rest: string[];
  flags: Record<string, string | boolean>;
};

const DEFAULT_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_HEARTBEAT_TASK_ID = 'default';
const DEFAULT_HEARTBEAT_TASK = [
  'Run a periodic autonomous heartbeat for this workspace.',
  'Read HEARTBEAT.md if it exists, inspect recent project state when useful, continue safe low-risk maintenance work, and escalate when human input is needed.',
].join(' ');

export async function runHeartbeatCli(args: string[], options: HeartbeatCliOptions = {}) {
  const parsed = parseHeartbeatArgs(args);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateDir = options.stateDir ?? '.heddle';
  const store = createFileHeartbeatTaskStore({
    dir: resolve(workspaceRoot, stateDir, 'heartbeat'),
  });

  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    printHeartbeatHelp();
    return;
  }

  if (parsed.command === 'task') {
    await runHeartbeatTaskCli(parsed, store, options);
    return;
  }

  if (parsed.command === 'run') {
    await runHeartbeatWorkerCli(parsed, store, options);
    return;
  }

  if (parsed.command === 'start') {
    await startHeartbeatCli(parsed, store, options);
    return;
  }

  throw new Error(`Unknown heartbeat command: ${parsed.command}`);
}

export function parseHeartbeatArgs(args: string[]): ParsedHeartbeatArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index++;
  }

  return {
    command: positionals[0],
    subcommand: positionals[1],
    rest: positionals.slice(2),
    flags,
  };
}

async function runHeartbeatTaskCli(
  parsed: ParsedHeartbeatArgs,
  store: ReturnType<typeof createFileHeartbeatTaskStore>,
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
    default:
      throw new Error(`Unknown heartbeat task command: ${parsed.subcommand}`);
  }
}

async function addHeartbeatTask(
  parsed: ParsedHeartbeatArgs,
  store: ReturnType<typeof createFileHeartbeatTaskStore>,
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

async function listHeartbeatTasks(store: ReturnType<typeof createFileHeartbeatTaskStore>) {
  const tasks = await store.listTasks();
  if (!tasks.length) {
    process.stdout.write('No heartbeat tasks found.\n');
    return;
  }

  for (const task of tasks) {
    process.stdout.write([
      `${task.enabled ? 'enabled ' : 'disabled'} ${task.id}${task.name ? ` (${task.name})` : ''}`,
      `  every=${formatDurationMs(task.intervalMs)} next=${task.nextRunAt ?? 'now'} model=${task.model ?? 'default'}`,
      `  task=${task.task}`,
      task.lastDecision ? `  last=${task.lastDecision} outcome=${task.lastOutcome ?? 'unknown'} runAt=${task.lastRunAt ?? 'unknown'}` : undefined,
      task.lastError ? `  error=${task.lastError}` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n') + '\n');
  }
}

async function setHeartbeatTaskEnabled(
  parsed: ParsedHeartbeatArgs,
  store: ReturnType<typeof createFileHeartbeatTaskStore>,
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

async function runHeartbeatWorkerCli(
  parsed: ParsedHeartbeatArgs,
  store: ReturnType<typeof createFileHeartbeatTaskStore>,
  options: HeartbeatCliOptions,
) {
  const model = stringFlag(parsed.flags, 'model') ?? options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = resolveProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`Missing API key for ${provider}. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`);
  }

  const heartbeat = {
    model,
    apiKey,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? options.maxSteps,
    workspaceRoot: options.workspaceRoot,
    stateDir: options.stateDir,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    onEvent: printAgentLoopEvent,
  };

  if (booleanFlag(parsed.flags, 'once')) {
    const result = await runDueHeartbeatTasks({
      store,
      heartbeat,
      onEvent: printSchedulerEvent,
    });
    process.stdout.write(`checked=${result.checked} ran=${result.ran} failed=${result.failed}\n`);
    return;
  }

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  await runHeartbeatScheduler({
    store,
    heartbeat,
    pollIntervalMs: parseDurationMs(stringFlag(parsed.flags, 'poll') ?? '60s'),
    signal: controller.signal,
    onEvent: printSchedulerEvent,
  });
}

async function startHeartbeatCli(
  parsed: ParsedHeartbeatArgs,
  store: ReturnType<typeof createFileHeartbeatTaskStore>,
  options: HeartbeatCliOptions,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.subcommand ?? DEFAULT_HEARTBEAT_TASK_ID;
  const intervalMs = parseDurationMs(stringFlag(parsed.flags, 'every') ?? stringFlag(parsed.flags, 'interval') ?? '30m');
  const pollIntervalMs = parseDurationMs(stringFlag(parsed.flags, 'poll') ?? '60s');
  const existing = (await store.listTasks()).find((task) => task.id === id);
  const now = new Date();
  const taskText = stringFlag(parsed.flags, 'task') ?? stringFlag(parsed.flags, 'goal') ?? existing?.task ?? DEFAULT_HEARTBEAT_TASK;
  const task: HeartbeatTask = {
    ...existing,
    id,
    name: stringFlag(parsed.flags, 'name') ?? existing?.name,
    task: taskText.trim(),
    enabled: true,
    intervalMs,
    nextRunAt: booleanFlag(parsed.flags, 'defer') ? new Date(now.getTime() + intervalMs).toISOString() : new Date(now.getTime() - 1_000).toISOString(),
    model: stringFlag(parsed.flags, 'model') ?? existing?.model ?? options.model,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? existing?.maxSteps ?? options.maxSteps,
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    stateDir: options.stateDir,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    updatedAt: now.toISOString(),
  };

  await store.saveTask(task);
  process.stdout.write(`Started heartbeat task ${task.id} (${formatDurationMs(intervalMs)} interval, poll ${formatDurationMs(pollIntervalMs)}). Press Ctrl+C to stop.\n`);

  await runHeartbeatWorkerCli({
    command: 'run',
    subcommand: undefined,
    rest: [],
    flags: {
      ...parsed.flags,
      poll: formatDurationMs(pollIntervalMs),
    },
  }, store, options);
}

function printAgentLoopEvent(event: AgentLoopEvent) {
  switch (event.type) {
    case 'loop.started':
      process.stdout.write(`[heartbeat] agent started run=${event.runId} model=${event.model}\n`);
      break;
    case 'loop.resumed':
      process.stdout.write(`[heartbeat] agent resumed from=${event.fromCheckpoint} priorTraceEvents=${event.priorTraceEvents}\n`);
      break;
    case 'tool.calling':
      process.stdout.write(`[heartbeat] tool calling step=${event.step} tool=${event.tool}${event.requiresApproval ? ' approval=true' : ''}\n`);
      break;
    case 'tool.completed':
      process.stdout.write(`[heartbeat] tool completed step=${event.step} tool=${event.tool} ok=${event.result.ok} durationMs=${event.durationMs}\n`);
      break;
    case 'assistant.stream':
      if (event.done) {
        process.stdout.write(`[heartbeat] assistant response complete step=${event.step}\n`);
      }
      break;
    case 'heartbeat.decision':
      process.stdout.write(`[heartbeat] decision=${event.decision} outcome=${event.outcome}\n`);
      break;
    case 'checkpoint.saved':
      process.stdout.write(`[heartbeat] checkpoint saved step=${event.step}\n`);
      break;
    case 'escalation.required':
      process.stdout.write(`[heartbeat] escalation required outcome=${event.outcome}\n`);
      break;
    case 'loop.finished':
      process.stdout.write(`[heartbeat] agent finished outcome=${event.outcome}\n`);
      break;
    case 'trace':
      break;
  }
}

function printSchedulerEvent(event: HeartbeatSchedulerEvent) {
  switch (event.type) {
    case 'heartbeat.scheduler.started':
      process.stdout.write('[heartbeat] scheduler started\n');
      break;
    case 'heartbeat.scheduler.stopped':
      process.stdout.write(`[heartbeat] scheduler stopped reason=${event.reason}\n`);
      break;
    case 'heartbeat.task.due':
      process.stdout.write(`[heartbeat] task due id=${event.taskId}\n`);
      break;
    case 'heartbeat.task.started':
      process.stdout.write(`[heartbeat] task started id=${event.taskId} loadedCheckpoint=${event.loadedCheckpoint}\n`);
      break;
    case 'heartbeat.task.finished':
      process.stdout.write(`[heartbeat] task finished id=${event.taskId} decision=${event.decision} enabled=${event.enabled} next=${event.nextRunAt ?? 'none'}\n`);
      break;
    case 'heartbeat.task.failed':
      process.stdout.write(`[heartbeat] task failed id=${event.taskId} error=${event.error} next=${event.nextRunAt ?? 'none'}\n`);
      break;
  }
}

function printHeartbeatHelp() {
  process.stdout.write([
    'Heddle heartbeat',
    '',
    'Usage:',
    '  heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m] [--model <name>] [--max-steps <n>]',
    '  heddle heartbeat task list',
    '  heddle heartbeat task enable <id>',
    '  heddle heartbeat task disable <id>',
    '  heddle heartbeat start [--every 30m] [--task "<durable task>"] [--model <name>]',
    '  heddle heartbeat run --once',
    '  heddle heartbeat run [--poll 60s]',
    '',
    'Duration examples:',
    '  30s, 15m, 1h, 2d',
    '',
  ].join('\n'));
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseDurationMs(raw: string): number {
  const match = raw.trim().match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) {
    throw new Error(`Invalid duration: ${raw}`);
  }

  const value = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid duration: ${raw}`);
  }

  const unit = match[2] ?? 'ms';
  const multiplier =
    unit === 'ms' ? 1
    : unit === 's' ? 1_000
    : unit === 'm' ? 60_000
    : unit === 'h' ? 60 * 60_000
    : 24 * 60 * 60_000;
  return value * multiplier;
}

export function formatDurationMs(value: number): string {
  if (value % (24 * 60 * 60_000) === 0) {
    return `${value / (24 * 60 * 60_000)}d`;
  }
  if (value % (60 * 60_000) === 0) {
    return `${value / (60 * 60_000)}h`;
  }
  if (value % 60_000 === 0) {
    return `${value / 60_000}m`;
  }
  if (value % 1_000 === 0) {
    return `${value / 1_000}s`;
  }
  return `${value}ms`;
}
