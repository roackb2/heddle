import type { ChatSession, LocalCommandResult } from './types.js';
import { summarizeSession } from './storage.js';
import type { OpenAiOAuthCredential } from '../../../core/auth/openai-oauth.js';
import type { ProviderCredentialSource } from '../utils/runtime.js';
import { createFileHeartbeatTaskStore } from '../../../core/runtime/heartbeat-task-store.js';
import { createSlashCommandRegistry } from '../../../core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '../../../core/commands/slash/modules/core-command-modules.js';
import { createTuiSlashCommandContext } from '../adapters/slash-command-context.js';
import { join } from 'node:path';

export type LocalCommandHint = {
  command: string;
  description: string;
};

export type LocalCommandArgs = {
  prompt: string;
  activeModel: string;
  setActiveModel: (model: string) => void;
  sessions: ChatSession[];
  recentSessions: ChatSession[];
  activeSessionId: string;
  switchSession: (id: string) => void;
  createSession: (name?: string) => ChatSession;
  renameSession: (name: string) => void;
  removeSession: (id: string) => void;
  clearConversation: () => void;
  compactConversation: () => Promise<string> | string;
  saveTuiSnapshot?: () => Promise<string> | string;
  driftEnabled: boolean;
  driftError?: string;
  setDriftEnabled: (enabled: boolean) => void;
  listRecentSessionsMessage: string[];
  workspaceRoot: string;
  stateRoot: string;
  credentialStorePath?: string;
  providerCredentialSource?: ProviderCredentialSource;
  openAiLogin?: () => Promise<OpenAiOAuthCredential>;
};

type ExactCommandHandler = (args: LocalCommandArgs) => Promise<LocalCommandResult> | LocalCommandResult;
type PrefixCommandHandler = (args: LocalCommandArgs, value: string) => Promise<LocalCommandResult> | LocalCommandResult;

const CORE_COMMAND_REGISTRY = createSlashCommandRegistry(createCoreSlashCommandModules());
const LOCAL_COMMAND_HINTS: LocalCommandHint[] = [
  { command: '/help', description: 'show available local commands' },
  { command: '/continue', description: 'resume from the current transcript' },
  { command: '/clear', description: 'reset the current session transcript' },
  { command: '/debug tui-snapshot', description: 'save the latest rendered TUI frame for inspection' },
  { command: '/heartbeat tasks', description: 'list heartbeat tasks' },
  { command: '/heartbeat task <id>', description: 'show one heartbeat task' },
  { command: '/heartbeat runs [task]', description: 'list recent heartbeat runs' },
  { command: '/heartbeat run <task> [run-id|latest]', description: 'show one heartbeat run' },
  { command: '/heartbeat continue <task> [run-id|latest]', description: 'continue in chat from a heartbeat run summary' },
  { command: '/session list', description: 'list local chat sessions' },
  { command: '/session choose [query]', description: 'pick a recent session with filtering' },
  { command: '/session new [name]', description: 'create and switch to a new session' },
  { command: '/session switch <id>', description: 'switch to another session' },
  { command: '/session continue <id>', description: 'switch to a session and resume it' },
  { command: '/session rename <name>', description: 'rename the current session' },
  { command: '/session close <id>', description: 'remove a saved session' },
  { command: '!<command>', description: 'run a shell command directly in chat using the current policy' },
];
const HELP_HINTS: LocalCommandHint[] = [
  LOCAL_COMMAND_HINTS[0]!,
  ...CORE_COMMAND_REGISTRY.hints(),
  ...LOCAL_COMMAND_HINTS.slice(1),
];
const COMMAND_ROOTS = Array.from(
  new Set(
    HELP_HINTS.filter((hint) => hint.command.startsWith('/'))
      .map((hint) => hint.command.slice(1).split(/\s+/, 1)[0] ?? '')
      .filter(Boolean),
  ),
) as ReadonlyArray<string>;
const HELP_MESSAGE = [
  'Local commands',
  '',
  ...HELP_HINTS.flatMap((hint) => [hint.command, capitalizeFirst(hint.description), '']),
].join('\n');

const EXACT_COMMANDS = new Map<string, ExactCommandHandler>([
  ['/help', () => messageResult(HELP_MESSAGE)],
  ['/clear', (args) => {
    args.clearConversation();
    return messageResult('Cleared the current chat transcript.');
  }],
  ['/debug tui-snapshot', async (args) =>
    messageResult(
      args.saveTuiSnapshot ? await args.saveTuiSnapshot() : 'TUI snapshots are not available in this runtime.',
    )],
  ['/heartbeat tasks', (args) => listHeartbeatTasksMessage(args)],
  ['/heartbeat runs', (args) => listHeartbeatRunsMessage(args, '')],
  ['/continue', () => ({ handled: true, kind: 'continue' })],
  ['/session list', (args) =>
    messageResult(args.sessions.length > 0 ? args.listRecentSessionsMessage.join('\n') : 'No sessions available.'),
  ],
  ['/session choose', () => messageResult('Use /session choose <query> to filter recent sessions, then use arrows and Enter to choose one.')],
]);

const PREFIX_COMMANDS: Array<{ prefix: string; handle: PrefixCommandHandler }> = [
  { prefix: '/heartbeat task ', handle: handleHeartbeatTask },
  { prefix: '/heartbeat runs ', handle: handleHeartbeatRuns },
  { prefix: '/heartbeat run ', handle: handleHeartbeatRun },
  { prefix: '/heartbeat continue ', handle: handleHeartbeatContinue },
  { prefix: '/session new', handle: handleSessionNew },
  { prefix: '/session switch ', handle: handleSessionSwitch },
  { prefix: '/session continue ', handle: handleSessionContinue },
  { prefix: '/session rename ', handle: handleSessionRename },
  { prefix: '/session close ', handle: handleSessionClose },
];

export function isLikelyLocalCommand(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) {
    return false;
  }

  const firstToken = trimmed.slice(1).split(/\s+/, 1)[0] ?? '';
  if (firstToken.includes('/')) {
    return false;
  }

  if (firstToken.length === 0) {
    return true;
  }

  if (COMMAND_ROOTS.some((root) => root.startsWith(firstToken))) {
    return true;
  }

  if (CORE_COMMAND_REGISTRY.find(trimmed)) {
    return true;
  }

  if (EXACT_COMMANDS.has(trimmed)) {
    return true;
  }

  return PREFIX_COMMANDS.some((entry) => trimmed === entry.prefix.trimEnd() || trimmed.startsWith(entry.prefix));
}

export function getLocalCommandHints(
  draft: string,
  activeSessionId: string,
  sessions: ChatSession[],
): LocalCommandHint[] {
  const trimmed = draft.trim();
  if (trimmed.startsWith('/session switch ')) {
    const sessionHints = sessions.map((session) => ({
      command: `/session switch ${session.id}`,
      description: `${session.id === activeSessionId ? '(current) ' : ''}${session.name}`,
    }));
    return sessionHints.filter((hint) => hint.command.startsWith(trimmed));
  }

  const filtered = HELP_HINTS.filter((hint) => hint.command.startsWith(trimmed) || trimmed === '/');
  return filtered.length > 0 ? filtered : HELP_HINTS;
}

export function autocompleteLocalCommand(
  draft: string,
  activeSessionId: string,
  sessions: ChatSession[],
): string | undefined {
  const leadingWhitespace = draft.match(/^\s*/)?.[0] ?? '';
  const trimmedStart = draft.trimStart();
  if (!isLikelyLocalCommand(trimmedStart)) {
    return undefined;
  }

  const completionCandidates = Array.from(
    new Set(
      getLocalCommandHints(trimmedStart, activeSessionId, sessions)
        .map((hint) => hintCommandToCompletionCandidate(hint.command))
        .filter((candidate) => candidate.startsWith(trimmedStart)),
    ),
  );
  if (completionCandidates.length === 0) {
    return undefined;
  }

  const sharedPrefix = longestSharedPrefix(completionCandidates);
  const expandedPrefix =
    completionCandidates.some((candidate) => candidate.startsWith(`${sharedPrefix} `)) ? `${sharedPrefix} ` : sharedPrefix;
  if (expandedPrefix.length > trimmedStart.length) {
    return `${leadingWhitespace}${expandedPrefix}`;
  }

  if (completionCandidates.length === 1 && completionCandidates[0] !== trimmedStart) {
    return `${leadingWhitespace}${completionCandidates[0]}`;
  }

  return undefined;
}

export async function runLocalCommand(args: LocalCommandArgs): Promise<LocalCommandResult> {
  const trimmed = args.prompt.trim();
  if (!isLikelyLocalCommand(trimmed)) {
    return { handled: false };
  }

  const coreResult = await CORE_COMMAND_REGISTRY.run(createTuiSlashCommandContext(args), trimmed);
  if (coreResult) {
    return coreResult;
  }

  const exact = EXACT_COMMANDS.get(trimmed);
  if (exact) {
    return await exact(args);
  }

  const matchedPrefix = PREFIX_COMMANDS.find((entry) => trimmed.startsWith(entry.prefix));
  if (matchedPrefix) {
    const value = trimmed.slice(matchedPrefix.prefix.length).trim();
    return await matchedPrefix.handle(args, value);
  }

  return messageResult(`Unknown command: ${trimmed}. Use /help for available commands.`);
}

async function handleHeartbeatTask(args: LocalCommandArgs, value: string): Promise<LocalCommandResult> {
  const taskId = value.trim();
  if (!taskId) {
    return messageResult('Usage: /heartbeat task <id>');
  }

  const store = heartbeatStore(args);
  const tasks = await store.listTasks();
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return messageResult(`Heartbeat task not found: ${taskId}`);
  }

  return messageResult(formatHeartbeatTask(task));
}

async function handleHeartbeatRuns(args: LocalCommandArgs, value: string): Promise<LocalCommandResult> {
  return listHeartbeatRunsMessage(args, value.trim());
}

async function handleHeartbeatRun(args: LocalCommandArgs, value: string): Promise<LocalCommandResult> {
  const [taskId, runRef = 'latest'] = value.split(/\s+/, 2);
  if (!taskId) {
    return messageResult('Usage: /heartbeat run <task> [run-id|latest]');
  }

  const run = await resolveHeartbeatRun(args, taskId, runRef);
  if (!run) {
    return messageResult(`Heartbeat run not found for task ${taskId}: ${runRef}`);
  }

  return messageResult(formatHeartbeatRun(run));
}

async function handleHeartbeatContinue(args: LocalCommandArgs, value: string): Promise<LocalCommandResult> {
  const [taskId, runRef = 'latest'] = value.split(/\s+/, 2);
  if (!taskId) {
    return messageResult('Usage: /heartbeat continue <task> [run-id|latest]');
  }

  const run = await resolveHeartbeatRun(args, taskId, runRef);
  if (!run) {
    return messageResult(`Heartbeat run not found for task ${taskId}: ${runRef}`);
  }

  return {
    handled: true,
    kind: 'execute',
    displayText: `Continue heartbeat ${taskId}`,
    message: `Loaded heartbeat run ${run.id} for task ${taskId}. Continuing from that background summary.`,
    prompt: buildHeartbeatContinuationPrompt(run),
  };
}

function handleSessionNew(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = args.createSession(value || undefined);
  return messageResult(`Created and switched to ${session.id} (${session.name}).`, session.id);
}

async function listHeartbeatTasksMessage(args: LocalCommandArgs): Promise<LocalCommandResult> {
  const tasks = await heartbeatStore(args).listTasks();
  if (!tasks.length) {
    return messageResult('No heartbeat tasks found.');
  }

  return messageResult(tasks.map((task) => {
    const next = task.nextRunAt ?? 'none';
    const decision = task.lastDecision ?? 'none';
    return [
      `${task.enabled ? 'enabled' : 'disabled'} ${task.id}`,
      `  status=${task.status ?? 'idle'} every=${formatInterval(task.intervalMs)} next=${next} decision=${decision}`,
      task.lastProgress ? `  progress=${task.lastProgress}` : undefined,
    ].filter((line): line is string => line !== undefined).join('\n');
  }).join('\n'));
}

async function listHeartbeatRunsMessage(args: LocalCommandArgs, taskId: string): Promise<LocalCommandResult> {
  const runs = await heartbeatStore(args).listRunRecords?.({
    taskId: taskId || undefined,
    limit: 10,
  });
  if (!runs?.length) {
    return messageResult(taskId ? `No heartbeat runs found for task ${taskId}.` : 'No heartbeat runs found.');
  }

  return messageResult(runs.map((run) => {
    const summary = firstLine(stripHeartbeatDecisionLine(run.record.result.summary));
    return `${run.id}\n  task=${run.taskId} decision=${run.record.result.decision} outcome=${run.record.result.state.outcome} finished=${run.createdAt}\n  summary=${summary}`;
  }).join('\n'));
}

function heartbeatStore(args: Pick<LocalCommandArgs, 'stateRoot'>) {
  return createFileHeartbeatTaskStore({
    dir: join(args.stateRoot, 'heartbeat'),
  });
}

async function resolveHeartbeatRun(
  args: Pick<LocalCommandArgs, 'stateRoot'>,
  taskId: string,
  runRef: string,
) {
  const store = heartbeatStore(args);
  if (runRef === 'latest') {
    return (await store.listRunRecords?.({ taskId, limit: 1 }))?.[0];
  }
  const run = await store.loadRunRecord?.(runRef);
  return run?.taskId === taskId ? run : undefined;
}

function formatHeartbeatTask(task: Awaited<ReturnType<ReturnType<typeof heartbeatStore>['listTasks']>>[number]): string {
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

function formatHeartbeatRun(run: NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof heartbeatStore>['loadRunRecord']>>>>): string {
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

function buildHeartbeatContinuationPrompt(run: NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof heartbeatStore>['loadRunRecord']>>>>): string {
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

function stripHeartbeatDecisionLine(summary: string): string {
  return summary.replace(/\n?\s*HEARTBEAT_DECISION:\s*(continue|pause|complete|escalate)\s*$/i, '');
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

function handleSessionSwitch(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(args, value);
  if (!session) {
    return messageResult(`Unknown session: ${value}. Use /session list to inspect available sessions.`);
  }

  args.switchSession(session.id);
  return messageResult(`Switched to ${session.id} (${session.name}).\n${summarizeSession(session)}`, session.id);
}

function handleSessionContinue(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(args, value);
  if (!session) {
    return messageResult(`Unknown session: ${value}.\nUse /session list to inspect available sessions.`);
  }

  return {
    handled: true,
    kind: 'continue',
    sessionId: session.id,
    message: `Switched to ${session.id} (${session.name}).\nContinuing from that session transcript.`,
  };
}

function handleSessionRename(args: LocalCommandArgs, value: string): LocalCommandResult {
  if (!value) {
    return messageResult('Usage: /session rename <name>');
  }

  args.renameSession(value);
  return messageResult(`Renamed current session to ${value}.`);
}

function handleSessionClose(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(args, value);
  if (!session) {
    return messageResult(`Unknown session: ${value}.\nUse /session list to inspect available sessions.`);
  }

  args.removeSession(session.id);
  return messageResult(`Closed ${session.id} (${session.name}).`);
}

function findSession(args: LocalCommandArgs, id: string): ChatSession | undefined {
  return args.sessions.find((candidate) => candidate.id === id);
}

function resolveSessionReference(args: LocalCommandArgs, value: string): ChatSession | undefined {
  const directMatch = findSession(args, value);
  if (directMatch) {
    return directMatch;
  }

  const numericIndex = Number.parseInt(value, 10);
  if (!Number.isFinite(numericIndex) || numericIndex <= 0) {
    return undefined;
  }

  return args.recentSessions[numericIndex - 1];
}

function messageResult(message: string, sessionId?: string): LocalCommandResult {
  return {
    handled: true,
    kind: 'message',
    message,
    sessionId,
  };
}

function hintCommandToCompletionCandidate(command: string): string {
  const placeholderMatch = command.match(/\s(?:<[^>]+>|\[[^\]]+\])/);
  if (!placeholderMatch || placeholderMatch.index === undefined) {
    return command;
  }

  return `${command.slice(0, placeholderMatch.index)} `;
}

function longestSharedPrefix(values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  let prefix = values[0] ?? '';
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (!prefix) {
      break;
    }
  }

  return prefix;
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}.` : value;
}
