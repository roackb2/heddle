import { resolve } from 'node:path';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatTask,
} from '@/core/heartbeat/index.js';
import type { ParsedHeartbeatArgs } from './args.js';
import { booleanFlag, parsePositiveInt, stringFlag } from './args.js';
import { formatDurationMs, parseDurationMs } from './duration.js';
import { printAgentLoopEvent, printSchedulerEvent } from './output.js';
import type { HeartbeatCliOptions, HeartbeatCliStore } from './types.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

const DEFAULT_HEARTBEAT_TASK_ID = 'default';
const DEFAULT_HEARTBEAT_TASK = [
  'Run a periodic autonomous heartbeat for this workspace.',
  'Read HEARTBEAT.md if it exists, inspect recent project state when useful, continue safe low-risk maintenance work, and escalate when human input is needed.',
].join(' ');

export async function runHeartbeatWorkerCli(
  parsed: ParsedHeartbeatArgs,
  _store: HeartbeatCliStore,
  options: HeartbeatCliOptions,
) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateRoot = resolve(workspaceRoot, options.stateDir ?? '.heddle');
  const store = new FileHeartbeatTaskService({ stateRoot });
  const runtime = {
    workspaceRoot,
    stateDir: stateRoot,
    model: stringFlag(parsed.flags, 'model') ?? options.model,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? options.maxSteps,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    onAgentEvent: printAgentLoopEvent,
  };

  if (booleanFlag(parsed.flags, 'once')) {
    const result = await HeartbeatSchedulerService.runDueTasks({
      store,
      runtime,
      onEvent: printSchedulerEvent,
    });
    process.stdout.write(`checked=${result.checked} ran=${result.ran} failed=${result.failed}\n`);
    return;
  }

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  await HeartbeatSchedulerService.runLoop({
    store,
    runtime,
    pollIntervalMs: parseDurationMs(stringFlag(parsed.flags, 'poll') ?? '60s'),
    signal: controller.signal,
    onEvent: printSchedulerEvent,
  });
}

export async function startHeartbeatCli(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
  options: HeartbeatCliOptions,
) {
  const id = stringFlag(parsed.flags, 'id') ?? parsed.subcommand ?? DEFAULT_HEARTBEAT_TASK_ID;
  const intervalMs = parseDurationMs(stringFlag(parsed.flags, 'every') ?? stringFlag(parsed.flags, 'interval') ?? '30m');
  const pollIntervalMs = parseDurationMs(stringFlag(parsed.flags, 'poll') ?? '60s');
  const existing = (await store.listTasks()).find((task) => task.id === id);
  const now = new Date();
  const taskText = stringFlag(parsed.flags, 'task') ?? stringFlag(parsed.flags, 'goal') ?? existing?.task ?? DEFAULT_HEARTBEAT_TASK;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const workspace = RuntimeWorkspaceService.resolveContext({
    workspaceRoot,
    stateRoot: resolve(workspaceRoot, options.stateDir ?? '.heddle'),
  }).activeWorkspace;
  const task: HeartbeatTask = {
    ...existing,
    id,
    workspaceId: existing?.workspaceId ?? workspace.id,
    name: stringFlag(parsed.flags, 'name') ?? existing?.name,
    task: taskText.trim(),
    enabled: true,
    schedule: {
      intervalMs,
      nextRunAt: booleanFlag(parsed.flags, 'defer') ? new Date(now.getTime() + intervalMs).toISOString() : new Date(now.getTime() - 1_000).toISOString(),
    },
    runtime: {
      ...existing?.runtime,
      model: stringFlag(parsed.flags, 'model') ?? existing?.runtime?.model ?? options.model,
      maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? existing?.runtime?.maxSteps ?? options.maxSteps,
      workspaceRoot,
      stateDir: options.stateDir,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
    },
    state: {
      ...existing?.state,
      updatedAt: now.toISOString(),
    },
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
