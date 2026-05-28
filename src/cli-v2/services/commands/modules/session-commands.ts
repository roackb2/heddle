import type { ControlPlaneSessionView } from '@/client-shared/api/types.js';
import { TerminalSlashCommandParser } from '../terminal-slash-command-parser.js';
import type {
  ParsedTerminalSlashCommand,
  TerminalSlashCommandContext,
  TerminalSlashCommandModule,
  TerminalSlashCommandResult,
} from '../types.js';
import { terminalSlashStatusResult } from './results.js';

export function createTerminalSessionSlashCommandModule(): TerminalSlashCommandModule {
  return {
    id: 'session',
    hints: [
      { command: '/new [name]', description: 'create and select a new control-plane chat session' },
      { command: '/sessions', description: 'refresh and show recent control-plane chat sessions' },
    ],
    commands: [
      {
        id: 'session.new',
        syntax: '/new [name]',
        description: 'create and select a new control-plane chat session',
        match: TerminalSlashCommandParser.matchesPrefix('/new'),
        execute: (context, input) => createNewSession(context, input),
      },
      {
        id: 'session.list',
        syntax: '/sessions',
        description: 'refresh and show recent control-plane chat sessions',
        match: TerminalSlashCommandParser.matchesExact('/sessions'),
        execute: (context) => showSessions(context),
      },
    ],
  };
}

async function createNewSession(
  context: TerminalSlashCommandContext,
  input: ParsedTerminalSlashCommand,
): Promise<TerminalSlashCommandResult> {
  if (context.isRunActive) {
    return {
      handled: true,
      error: 'Cannot create a new session while the current run is active.',
    };
  }

  const session = await context.createSession(input.rest ? { name: input.rest } : {});
  await context.selectSession(session.id);
  return terminalSlashStatusResult('Created new session', session.name, 'success');
}

async function showSessions(context: TerminalSlashCommandContext): Promise<TerminalSlashCommandResult> {
  const sessions = await context.refreshSessions();
  return terminalSlashStatusResult('Sessions refreshed', formatSessions(sessions, context.activeSessionId), 'info');
}

function formatSessions(sessions: ControlPlaneSessionView[], activeSessionId?: string): string {
  if (!sessions.length) {
    return 'No sessions available.';
  }

  return sessions
    .slice(0, 8)
    .map((session) => `${session.id === activeSessionId ? '* ' : ''}${session.name} (${session.id})`)
    .join('\n');
}
