import type { ChatSession, LocalCommandResult } from './types.js';
import type { OpenAiOAuthCredential } from '../../../core/auth/openai-oauth.js';
import type { ProviderCredentialSource } from '../utils/runtime.js';
import { createSlashCommandRegistry } from '../../../core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '../../../core/commands/slash/modules/core-command-modules.js';
import { createTuiSlashCommandContext } from '../adapters/slash-command-context.js';
import { createTuiDebugSnapshotCommandModule } from '../commands/debug-snapshot-command.js';

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

const CORE_COMMAND_REGISTRY = createSlashCommandRegistry(createCoreSlashCommandModules());
const TUI_COMMAND_REGISTRY = createSlashCommandRegistry([createTuiDebugSnapshotCommandModule()]);
const LOCAL_COMMAND_HINTS: LocalCommandHint[] = [
  { command: '/help', description: 'show available local commands' },
  { command: '!<command>', description: 'run a shell command directly in chat using the current policy' },
];
const HELP_HINTS: LocalCommandHint[] = [
  LOCAL_COMMAND_HINTS[0]!,
  ...CORE_COMMAND_REGISTRY.hints(),
  ...TUI_COMMAND_REGISTRY.hints(),
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

  if (TUI_COMMAND_REGISTRY.find(trimmed)) {
    return true;
  }

  return false;
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

  if (trimmed === '/help') {
    return messageResult(HELP_MESSAGE);
  }

  const coreResult = await CORE_COMMAND_REGISTRY.run(createTuiSlashCommandContext(args), trimmed);
  if (coreResult) {
    return coreResult;
  }

  const tuiResult = await TUI_COMMAND_REGISTRY.run(args, trimmed);
  if (tuiResult) {
    return tuiResult;
  }

  return messageResult(`Unknown command: ${trimmed}. Use /help for available commands.`);
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
