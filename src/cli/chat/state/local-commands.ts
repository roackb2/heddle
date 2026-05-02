import type { ChatSession } from './types.js';
import type { OpenAiOAuthCredential } from '../../../core/auth/openai-oauth.js';
import type { ProviderCredentialSource } from '../utils/runtime.js';
import { autocompleteSlashCommand, filterSlashCommandHints } from '../../../core/commands/slash/autocomplete.js';
import { createSlashCommandRegistry } from '../../../core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '../../../core/commands/slash/modules/core-command-modules.js';
import type { SlashCommandResult } from '../../../core/commands/slash/result-types.js';
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
  if (!isLikelyLocalCommand(trimmed)) {
    return [];
  }

  if (trimmed.startsWith('/session switch ')) {
    const sessionHints = sessions.map((session) => ({
      command: `/session switch ${session.id}`,
      description: `${session.id === activeSessionId ? '(current) ' : ''}${session.name}`,
    }));
    return sessionHints.filter((hint) => hint.command.startsWith(trimmed));
  }

  return filterSlashCommandHints(trimmed, HELP_HINTS);
}

export function autocompleteLocalCommand(
  draft: string,
  activeSessionId: string,
  sessions: ChatSession[],
): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!isLikelyLocalCommand(trimmedStart)) {
    return undefined;
  }

  return autocompleteSlashCommand(draft, getLocalCommandHints(trimmedStart, activeSessionId, sessions));
}

export async function runLocalCommand(args: LocalCommandArgs): Promise<SlashCommandResult> {
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

function messageResult(message: string, sessionId?: string): SlashCommandResult {
  return {
    handled: true,
    kind: 'message',
    message,
    sessionId,
  };
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}.` : value;
}
