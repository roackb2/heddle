import { matchesExactSlashCommand, matchesSlashCommandPrefix } from '../../parser.js';
import type { SlashCommandModule } from '../../types.js';
import type { ChatSession } from '../../../../chat/types.js';
import type { CoreSlashCommandResult, SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';

export function createSessionSlashCommandModule(): SlashCommandModule<CoreSlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'session',
    hints: [
      { command: '/continue', description: 'resume from the current transcript' },
      { command: '/clear', description: 'reset the current session transcript' },
      { command: '/session list', description: 'list local chat sessions' },
      { command: '/session choose [query]', description: 'pick a recent session with filtering' },
      { command: '/session new [name]', description: 'create and switch to a new session' },
      { command: '/session switch <id>', description: 'switch to another session' },
      { command: '/session continue <id>', description: 'switch to a session and resume it' },
      { command: '/session rename <name>', description: 'rename the current session' },
      { command: '/session close <id>', description: 'remove a saved session' },
    ],
    commands: [
      {
        id: 'session.continue-current',
        syntax: '/continue',
        description: 'resume from the current transcript',
        match: matchesExactSlashCommand('/continue'),
        run: () => ({ handled: true, kind: 'continue' }),
      },
      {
        id: 'session.clear',
        syntax: '/clear',
        description: 'reset the current session transcript',
        match: matchesExactSlashCommand('/clear'),
        run: (context) => {
          context.session.clear();
          return slashMessageResult('Cleared the current chat transcript.');
        },
      },
      {
        id: 'session.list',
        syntax: '/session list',
        description: 'list local chat sessions',
        match: matchesExactSlashCommand('/session list'),
        run: (context) =>
          slashMessageResult(
            context.session.all().length > 0 ?
              context.session.recentListMessage().join('\n')
            : 'No sessions available.',
          ),
      },
      {
        id: 'session.choose.help',
        syntax: '/session choose',
        description: 'pick a recent session with filtering',
        match: matchesExactSlashCommand('/session choose'),
        run: () =>
          slashMessageResult('Use /session choose <query> to filter recent sessions, then use arrows and Enter to choose one.'),
      },
      {
        id: 'session.new',
        syntax: '/session new [name]',
        description: 'create and switch to a new session',
        match: matchesSlashCommandPrefix('/session new'),
        run: (context, input) => createSession(context, argumentAfterPrefix(input, '/session new')),
      },
      {
        id: 'session.switch',
        syntax: '/session switch <id>',
        description: 'switch to another session',
        match: matchesRequiredSessionArgument('/session switch'),
        run: (context, input) => switchSession(context, argumentAfterPrefix(input, '/session switch')),
      },
      {
        id: 'session.continue',
        syntax: '/session continue <id>',
        description: 'switch to a session and resume it',
        match: matchesRequiredSessionArgument('/session continue'),
        run: (context, input) => continueSession(context, argumentAfterPrefix(input, '/session continue')),
      },
      {
        id: 'session.rename',
        syntax: '/session rename <name>',
        description: 'rename the current session',
        match: matchesRequiredSessionArgument('/session rename'),
        run: (context, input) => renameSession(context, argumentAfterPrefix(input, '/session rename')),
      },
      {
        id: 'session.close',
        syntax: '/session close <id>',
        description: 'remove a saved session',
        match: matchesRequiredSessionArgument('/session close'),
        run: (context, input) => closeSession(context, argumentAfterPrefix(input, '/session close')),
      },
    ],
  };
}

function matchesRequiredSessionArgument(prefix: string): (input: { raw: string }) => boolean {
  return (input) => input.raw.startsWith(`${prefix} `);
}

export function resolveSessionReference(args: {
  sessions: ChatSession[];
  recentSessions: ChatSession[];
  value: string;
}): ChatSession | undefined {
  const directMatch = args.sessions.find((candidate) => candidate.id === args.value);
  if (directMatch) {
    return directMatch;
  }

  const numericIndex = Number.parseInt(args.value, 10);
  return Number.isFinite(numericIndex) && numericIndex > 0 ? args.recentSessions[numericIndex - 1] : undefined;
}

function createSession(
  context: SlashCommandExecutionContext,
  name: string,
): CoreSlashCommandResult {
  const session = context.session.create(name || undefined);
  return slashMessageResult(`Created and switched to ${session.id} (${session.name}).`, session.id);
}

function switchSession(
  context: SlashCommandExecutionContext,
  value: string,
): CoreSlashCommandResult {
  const session = findSession(context, value);
  if (!session) {
    return slashMessageResult(`Unknown session: ${value}. Use /session list to inspect available sessions.`);
  }

  context.session.switch(session.id);
  return slashMessageResult(`Switched to ${session.id} (${session.name}).\n${context.session.summarize(session)}`, session.id);
}

function continueSession(
  context: SlashCommandExecutionContext,
  value: string,
): CoreSlashCommandResult {
  const session = findSession(context, value);
  if (!session) {
    return slashMessageResult(`Unknown session: ${value}.\nUse /session list to inspect available sessions.`);
  }

  return {
    handled: true,
    kind: 'continue',
    sessionId: session.id,
    message: `Switched to ${session.id} (${session.name}).\nContinuing from that session transcript.`,
  };
}

function renameSession(
  context: SlashCommandExecutionContext,
  name: string,
): CoreSlashCommandResult {
  if (!name) {
    return slashMessageResult('Usage: /session rename <name>');
  }

  context.session.rename(name);
  return slashMessageResult(`Renamed current session to ${name}.`);
}

function closeSession(
  context: SlashCommandExecutionContext,
  value: string,
): CoreSlashCommandResult {
  const session = findSession(context, value);
  if (!session) {
    return slashMessageResult(`Unknown session: ${value}.\nUse /session list to inspect available sessions.`);
  }

  context.session.remove(session.id);
  return slashMessageResult(`Closed ${session.id} (${session.name}).`);
}

function findSession(
  context: SlashCommandExecutionContext,
  value: string,
): ChatSession | undefined {
  return resolveSessionReference({
    sessions: context.session.all(),
    recentSessions: context.session.recent(),
    value,
  });
}
