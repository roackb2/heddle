import type { ChatSession, LocalCommandResult } from './types.js';
import { summarizeSession } from './storage.js';
import { COMMON_BUILT_IN_MODELS, formatBuiltInModelGroups } from '../../../llm/openai-models.js';

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
  listRecentSessionsMessage: string[];
};

type ExactCommandHandler = (args: LocalCommandArgs) => LocalCommandResult;
type PrefixCommandHandler = (args: LocalCommandArgs, value: string) => LocalCommandResult;

const MODEL_LIST_MESSAGE = ['Common built-in model choices', '', formatBuiltInModelGroups()].join('\n');
const MODEL_SET_HELP_MESSAGE = 'Use /model set <query> to filter models, then use arrows and Enter to choose one.';
const HELP_MESSAGE = [
  'Local commands',
  '',
  '/model',
  'Show the active model.',
  '',
  '/model <name>',
  'Switch the current model.',
  '',
  '/model set [query]',
  'Open the interactive model picker and filter it by query.',
  '',
  '/model list',
  'List common model choices.',
  '',
  '/continue',
  'Resume the current session from its last interrupted or prior run.',
  '',
  '/clear',
  'Reset the current session transcript.',
  '',
  '/session list',
  'List recent saved sessions.',
  '',
  '/session choose [query]',
  'Pick a recent session with filtering and arrow-key selection.',
  '',
  '/session new [name]',
  'Create and switch to a new session.',
  '',
  '/session switch <id>',
  'Switch to another saved session.',
  '',
  '/session continue <id>',
  'Switch to another saved session and immediately resume it.',
  '',
  '/session rename <name>',
  'Rename the current session.',
  '',
  '/session close <id>',
  'Remove a saved session.',
  '',
  '!<command>',
  'Run a shell command directly in chat using the current inspect or execute policy.',
  '',
  '/help',
  'Show this message.',
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

  if (EXACT_COMMANDS.has(trimmed)) {
    return true;
  }

  return PREFIX_COMMANDS.some((entry) => trimmed === entry.prefix.trimEnd() || trimmed.startsWith(entry.prefix));
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
