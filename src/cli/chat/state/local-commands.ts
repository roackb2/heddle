import type { ChatSession, LocalCommandResult } from './types.js';
import { summarizeSession } from './storage.js';
import { COMMON_BUILT_IN_MODELS, formatBuiltInModelGroups } from '../../../llm/openai-models.js';

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
  compactConversation: () => string;
  listRecentSessionsMessage: string[];
};

type ExactCommandHandler = (args: LocalCommandArgs) => LocalCommandResult;
type PrefixCommandHandler = (args: LocalCommandArgs, value: string) => LocalCommandResult;

const MODEL_LIST_MESSAGE = ['Common built-in model choices', '', formatBuiltInModelGroups()].join('\n');
const MODEL_SET_HELP_MESSAGE = 'Use /model set <query> to filter models, then use arrows and Enter to choose one.';
const HELP_HINTS: LocalCommandHint[] = [
  { command: '/help', description: 'show available local commands' },
  { command: '/model', description: 'show the active model' },
  { command: '/model <name>', description: 'switch the current model' },
  { command: '/model set [query]', description: 'pick a model with filtering' },
  { command: '/model list', description: 'list common built-in models' },
  { command: '/continue', description: 'resume from the current transcript' },
  { command: '/clear', description: 'reset the current session transcript' },
  { command: '/compact', description: 'compact earlier session history for the next run' },
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
  ['/clear', (args) => {
    args.clearConversation();
    return messageResult('Cleared the current chat transcript.');
  }],
  ['/compact', (args) => messageResult(args.compactConversation())],
  ['/continue', () => ({ handled: true, kind: 'continue' })],
  ['/session list', (args) =>
    messageResult(args.sessions.length > 0 ? args.listRecentSessionsMessage.join('\n') : 'No sessions available.'),
  ],
  ['/session choose', () => messageResult('Use /session choose <query> to filter recent sessions, then use arrows and Enter to choose one.')],
]);

const PREFIX_COMMANDS: Array<{ prefix: string; handle: PrefixCommandHandler }> = [
  { prefix: '/model ', handle: handleModelCommand },
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

export function runLocalCommand(args: LocalCommandArgs): LocalCommandResult {
  const trimmed = args.prompt.trim();
  if (!isLikelyLocalCommand(trimmed)) {
    return { handled: false };
  }

  const exact = EXACT_COMMANDS.get(trimmed);
  if (exact) {
    return exact(args);
  }

  const matchedPrefix = PREFIX_COMMANDS.find((entry) => trimmed.startsWith(entry.prefix));
  if (matchedPrefix) {
    const value = trimmed.slice(matchedPrefix.prefix.length).trim();
    return matchedPrefix.handle(args, value);
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

function handleSessionNew(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = args.createSession(value || undefined);
  return messageResult(`Created and switched to ${session.id} (${session.name}).`);
}

function handleSessionSwitch(args: LocalCommandArgs, value: string): LocalCommandResult {
  const session = resolveSessionReference(args, value);
  if (!session) {
    return messageResult(`Unknown session: ${value}. Use /session list to inspect available sessions.`);
  }

  args.switchSession(session.id);
  return messageResult(`Switched to ${session.id} (${session.name}).\n${summarizeSession(session)}`);
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

function messageResult(message: string): LocalCommandResult {
  return {
    handled: true,
    kind: 'message',
    message,
  };
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}.` : value;
}
