import type { ChatSession, LocalCommandResult } from './types.js';
import { summarizeSession } from './storage.js';
import { formatAuthStatusMessage, loginProviderWithOAuth, logoutProvider } from '../../auth.js';
import type { OpenAiOAuthCredential } from '../../../core/auth/openai-oauth.js';
import { COMMON_BUILT_IN_MODELS, formatBuiltInModelGroups } from '../../../core/llm/openai-models.js';
import { resolveDefaultReasoningEffort, supportsReasoningEffort } from '../../../core/llm/model-policy.js';
import type { LlmProvider, ReasoningEffort } from '../../../core/llm/types.js';
import { createFileHeartbeatTaskStore } from '../../../core/runtime/heartbeat-task-store.js';
import { join } from 'node:path';

export type LocalCommandHint = {
  command: string;
  description: string;
};

export type LocalCommandArgs = {
  prompt: string;
  activeModel: string;
  activeReasoningEffort?: ReasoningEffort;
  setActiveModel: (model: string) => void;
  setActiveReasoningEffort: (effort: ReasoningEffort | undefined) => void;
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
  openAiLogin?: () => Promise<OpenAiOAuthCredential>;
};

type ExactCommandHandler = (args: LocalCommandArgs) => Promise<LocalCommandResult> | LocalCommandResult;
type PrefixCommandHandler = (args: LocalCommandArgs, value: string) => Promise<LocalCommandResult> | LocalCommandResult;

const MODEL_LIST_MESSAGE = ['Common built-in model choices', '', formatBuiltInModelGroups()].join('\n');
const MODEL_SET_HELP_MESSAGE = 'Use /model set <query> to filter models, then use arrows and Enter to choose one.';
const HELP_HINTS: LocalCommandHint[] = [
  { command: '/help', description: 'show available local commands' },
  { command: '/model', description: 'show the active model' },
  { command: '/model <name>', description: 'switch the current model' },
  { command: '/model set [query]', description: 'pick a model with filtering' },
  { command: '/model list', description: 'list common built-in models' },
  { command: '/reasoning', description: 'show reasoning effort for the current session' },
  { command: '/reasoning <level>', description: 'set reasoning effort to low, medium, high, or ultrahigh' },
  { command: '/reasoning default', description: 'clear explicit reasoning effort and use the model default' },
  { command: '/auth', description: 'show stored provider credentials' },
  { command: '/auth status', description: 'show stored provider credentials' },
  { command: '/auth login openai', description: 'sign in with OpenAI ChatGPT/Codex OAuth' },
  { command: '/auth logout <provider>', description: 'remove a stored provider credential' },
  { command: '/continue', description: 'resume from the current transcript' },
  { command: '/clear', description: 'reset the current session transcript' },
  { command: '/compact', description: 'compact earlier session history for the next run' },
  { command: '/debug tui-snapshot', description: 'save the latest rendered TUI frame for inspection' },
  { command: '/drift', description: 'show CyberLoop semantic drift detection status' },
  { command: '/drift on', description: 'enable CyberLoop semantic drift detection for chat runs' },
  { command: '/drift off', description: 'disable CyberLoop semantic drift detection' },
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
  ['/models', () => messageResult(MODEL_LIST_MESSAGE)],
  ['/model list', () => messageResult(MODEL_LIST_MESSAGE)],
  ['/model', (args) => messageResult(`Current model: ${args.activeModel}`)],
  ['/model set', () => messageResult(MODEL_SET_HELP_MESSAGE)],
  ['/reasoning', (args) => messageResult(formatReasoningEffortStatus(args.activeModel, args.activeReasoningEffort))],
  ['/auth', (args) => messageResult(formatAuthStatusMessage(args.credentialStorePath))],
  ['/auth status', (args) => messageResult(formatAuthStatusMessage(args.credentialStorePath))],
  ['/clear', (args) => {
    args.clearConversation();
    return messageResult('Cleared the current chat transcript.');
  }],
  ['/compact', async (args) => messageResult(await args.compactConversation())],
  ['/debug tui-snapshot', async (args) =>
    messageResult(
      args.saveTuiSnapshot ? await args.saveTuiSnapshot() : 'TUI snapshots are not available in this runtime.',
    )],
  ['/drift', (args) => messageResult(formatDriftStatus(args.driftEnabled, args.driftError))],
  ['/drift status', (args) => messageResult(formatDriftStatus(args.driftEnabled, args.driftError))],
  ['/drift on', (args) => {
    args.setDriftEnabled(true);
    return messageResult('Enabled CyberLoop semantic drift detection for chat runs. Heddle will load real CyberLoop kinematics middleware and write annotations into traces.');
  }],
  ['/drift off', (args) => {
    args.setDriftEnabled(false);
    return messageResult('Disabled CyberLoop semantic drift detection.');
  }],
  ['/heartbeat tasks', (args) => listHeartbeatTasksMessage(args)],
  ['/heartbeat runs', (args) => listHeartbeatRunsMessage(args, '')],
  ['/continue', () => ({ handled: true, kind: 'continue' })],
  ['/session list', (args) =>
    messageResult(args.sessions.length > 0 ? args.listRecentSessionsMessage.join('\n') : 'No sessions available.'),
  ],
  ['/session choose', () => messageResult('Use /session choose <query> to filter recent sessions, then use arrows and Enter to choose one.')],
]);

const PREFIX_COMMANDS: Array<{ prefix: string; handle: PrefixCommandHandler }> = [
  { prefix: '/model ', handle: handleModelCommand },
  { prefix: '/reasoning ', handle: handleReasoningCommand },
  { prefix: '/auth login ', handle: handleAuthLogin },
  { prefix: '/auth logout ', handle: handleAuthLogout },
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

function handleModelCommand(args: LocalCommandArgs, value: string): LocalCommandResult {
  if (!value) {
    return messageResult('Usage: /model <name>');
  }

  const modelCommandAliases = new Map<string, LocalCommandResult>([
    ['list', messageResult(MODEL_LIST_MESSAGE)],
    ['set', messageResult(MODEL_SET_HELP_MESSAGE)],
  ]);

  const aliased = modelCommandAliases.get(value);
  if (aliased) {
    return aliased;
  }

  args.setActiveModel(value);
  return messageResult(
    COMMON_BUILT_IN_MODELS.includes(value) ?
      `Switched model to ${value}`
    : `Switched model to ${value}. This name is not in Heddle's common shortlist, so the next API call will fail if the provider does not recognize it.`,
  );
}

function handleReasoningCommand(args: LocalCommandArgs, value: string): LocalCommandResult {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return messageResult(formatReasoningEffortStatus(args.activeModel, args.activeReasoningEffort));
  }

  if (normalized === 'default') {
    args.setActiveReasoningEffort(undefined);
    return messageResult(
      `Cleared explicit reasoning effort for ${args.activeModel}. Effective default: ${resolveDefaultReasoningEffort(args.activeModel) ?? 'not supported'}.`,
    );
  }

  if (!isReasoningEffort(normalized)) {
    return messageResult('Usage: /reasoning <low|medium|high|ultrahigh|default>');
  }

  if (!supportsReasoningEffort(args.activeModel)) {
    return messageResult(`Reasoning effort is not supported for model ${args.activeModel}.`);
  }

  args.setActiveReasoningEffort(normalized);
  return messageResult(`Set reasoning effort to ${normalized} for ${args.activeModel}.`);
}

async function handleAuthLogin(args: LocalCommandArgs, value: string): Promise<LocalCommandResult> {
  const provider = parseAuthProvider(value);
  if (!provider) {
    return messageResult('Usage: /auth login <provider>');
  }

  try {
    const message = await loginProviderWithOAuth(provider, {
      storePath: args.credentialStorePath,
      openAiLogin: args.openAiLogin,
    });
    return messageResult(message);
  } catch (error) {
    return messageResult(`Auth login failed. ${formatErrorMessage(error)}`);
  }
}

function handleAuthLogout(args: LocalCommandArgs, value: string): LocalCommandResult {
  const provider = parseAuthProvider(value);
  if (!provider) {
    return messageResult('Usage: /auth logout <provider>');
  }

  try {
    return messageResult(logoutProvider(provider, args.credentialStorePath));
  } catch (error) {
    return messageResult(`Auth logout failed. ${formatErrorMessage(error)}`);
  }
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

function formatReasoningEffortStatus(model: string, explicitEffort: ReasoningEffort | undefined): string {
  const supported = supportsReasoningEffort(model);
  const effective = explicitEffort ?? resolveDefaultReasoningEffort(model);
  return [
    `Current model: ${model}`,
    `Reasoning effort support: ${supported ? 'supported' : 'unsupported'}`,
    `Configured effort: ${explicitEffort ?? 'default'}`,
    `Effective effort: ${effective ?? 'none'}`,
    '',
    'Use /reasoning <low|medium|high|ultrahigh|default> to update this session.',
  ].join('\n');
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultrahigh';
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

function buildHeartbeatContinuationPrompt(run: Awaited<ReturnType<ReturnType<typeof heartbeatStore>['listRunRecords']>>[number]): string {
  const checkpointState = run.record.result.checkpoint?.state;
  const checkpointSummary = checkpointState?.summary?.trim();
  const traceTail = checkpointState?.trace?.slice(-12) ?? [];
  const traceLines = traceTail.map((event) => {
    const base = [event.type];
    const step = typeof event.step === 'number' ? `step=${event.step}` : undefined;
    const tool = typeof event.tool === 'string' ? `tool=${event.tool}` : undefined;
    const cmd = typeof event.command === 'string' ? `cmd=${event.command}` : undefined;
    const detail = typeof event.message === 'string' ? event.message : undefined;
    return ['- ', ...base, step ? ` (${step}${tool ? `, ${tool}` : ''}${cmd ? `, ${cmd}` : ''})` : tool ? ` (${tool}${cmd ? `, ${cmd}` : ''})` : '', detail ? `: ${detail}` : ''].join('');
  });

  return [
    `Continue from heartbeat task ${run.taskId}.`,
    '',
    `Decision: ${run.record.result.decision}`,
    `Run id: ${run.id}`,
    `Created at: ${run.createdAt}`,
    `Loaded checkpoint: ${run.record.loadedCheckpoint ? 'yes' : 'no'}`,
    checkpointState?.outcome ? `Checkpoint outcome: ${checkpointState.outcome}` : undefined,
    checkpointSummary ? ['', 'Checkpoint summary:', checkpointSummary] : undefined,
    traceLines.length > 0 ? ['', 'Recent trace tail:', ...traceLines] : undefined,
    '',
    'Pick up from the saved checkpoint state and continue the most useful next step for the task.',
  ].flatMap((line) => line === undefined ? [] : Array.isArray(line) ? line : [line]).join('\n');
}

function stripHeartbeatDecisionLine(summary: string): string {
  return summary.replace(/\n\nHEARTBEAT_DECISION:[\s\S]*$/u, '').trim();
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u)[0] ?? value;
}

function formatInterval(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60_000);
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function parseAuthProvider(value: string): LlmProvider | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'anthropic') {
    return normalized;
  }
  return undefined;
}

function resolveSessionReference(
  value: string,
  sessions: ChatSession[],
  recentSessions: ChatSession[],
): ChatSession | undefined {
  const directMatch = sessions.find((session) => session.id === value || session.name === value);
  if (directMatch) {
    return directMatch;
  }

  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= recentSessions.length) {
    return recentSessions[numeric - 1];
  }

  return undefined;
}

function handleSessionSwitch(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(value, args.sessions, args.recentSessions);
  if (!session) {
    return messageResult(`Could not find a session for “${value}”. Use /session list first.`);
  }

  args.switchSession(session.id);
  return messageResult(`Switched to ${session.id} (${session.name}).\n${summarizeSession(session)}`, session.id);
}

function handleSessionContinue(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(value, args.sessions, args.recentSessions);
  if (!session) {
    return messageResult(`Could not find a session for “${value}”. Use /session list first.`);
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
  return messageResult(`Renamed current session to “${value}”.`);
}

function handleSessionClose(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(value, args.sessions, args.recentSessions);
  if (!session) {
    return messageResult(`Could not find a session for “${value}”. Use /session list first.`);
  }

  args.removeSession(session.id);
  return messageResult(`Closed session ${session.id} (${session.name}).`);
}

function messageResult(message: string, sessionId?: string): LocalCommandResult {
  return sessionId ? { handled: true, kind: 'message', message, sessionId } : { handled: true, kind: 'message', message };
}

function formatDriftStatus(enabled: boolean, error?: string): string {
  return enabled ?
    error ? `CyberLoop drift detection is enabled, but the last run could not initialize it.\n${error}` : 'CyberLoop drift detection is enabled. Heddle will load real CyberLoop kinematics middleware and write semantic drift annotations into traces.'
  : 'CyberLoop drift detection is disabled.';
}

function hintCommandToCompletionCandidate(command: string): string {
  return command.replace(/\s*\[[^\]]+\]/g, '').replace(/\s*<[^>]+>/g, '').replace(/\s+/g, ' ').trimEnd();
}

function longestSharedPrefix(values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  let prefix = values[0] ?? '';
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] ?? '';
    while (!value.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) {
      break;
    }
  }
  return prefix;
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}.` : value;
}
