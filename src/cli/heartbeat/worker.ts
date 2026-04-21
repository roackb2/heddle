import {
  inferProviderFromModel,
  resolveProviderApiKey,
  runDueHeartbeatTasks,
  runHeartbeatScheduler,
  type HeartbeatTask,
  type ToolCall,
  type ToolDefinition,
} from '../../index.js';
import { resolve } from 'node:path';
import type { ParsedHeartbeatArgs } from './args.js';
import { booleanFlag, parsePositiveInt, stringFlag } from './args.js';
import { formatDurationMs, parseDurationMs } from './duration.js';
import { printAgentLoopEvent, printSchedulerEvent } from './output.js';
import type { HeartbeatCliOptions, HeartbeatCliStore } from './types.js';
import { resolveWorkspaceContext } from '../../core/runtime/workspaces.js';

const DEFAULT_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_HEARTBEAT_TASK_ID = 'default';
const DEFAULT_HEARTBEAT_TASK = [
  'Run a periodic autonomous heartbeat for this workspace.',
  'Read HEARTBEAT.md if it exists, inspect recent project state when useful, continue safe low-risk maintenance work, and escalate when human input is needed.',
].join(' ');

export async function runHeartbeatWorkerCli(
  parsed: ParsedHeartbeatArgs,
  store: HeartbeatCliStore,
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
    approveToolCall: approveAutonomousHeartbeatToolCall,
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
  const workspace = resolveWorkspaceContext({
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
    intervalMs,
    nextRunAt: booleanFlag(parsed.flags, 'defer') ? new Date(now.getTime() + intervalMs).toISOString() : new Date(now.getTime() - 1_000).toISOString(),
    model: stringFlag(parsed.flags, 'model') ?? existing?.model ?? options.model,
    maxSteps: parsePositiveInt(stringFlag(parsed.flags, 'max-steps')) ?? existing?.maxSteps ?? options.maxSteps,
    workspaceRoot,
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

async function approveAutonomousHeartbeatToolCall(
  call: ToolCall,
  _toolDef: ToolDefinition,
): Promise<{ approved: boolean; reason?: string }> {
  return {
    approved: false,
    reason:
      call.tool === 'edit_file' || call.tool === 'run_shell_mutate' ?
        'The heartbeat CLI has no live approval UI. Use read-only tools, memory notes, or run the task in chat for approved workspace changes.'
      : 'The heartbeat CLI cannot approve this tool call interactively.',
  };
}
