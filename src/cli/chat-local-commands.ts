import type { ChatSession, LocalCommandResult } from './chat-types.js';
import { summarizeSession } from './chat-storage.js';

const knownModels = ['gpt-5.1-codex-mini', 'gpt-5.1-codex'];

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

export function runLocalCommand(args: LocalCommandArgs): LocalCommandResult {
  const trimmed = args.prompt.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  if (trimmed === '/help') {
    return {
      handled: true,
      kind: 'message',
      message: [
        'Local commands',
        '',
        '/model',
        'Show the active model.',
        '',
        '/model <name>',
        'Switch the current model.',
        '',
        '/models',
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
      ].join('\n'),
    };
  }

  if (trimmed === '/models') {
    return {
      handled: true,
      kind: 'message',
      message: `Common model choices: ${knownModels.join(', ')}`,
    };
  }

  if (trimmed === '/model') {
    return {
      handled: true,
      kind: 'message',
      message: `Current model: ${args.activeModel}`,
    };
  }

  if (trimmed.startsWith('/model ')) {
    const nextModel = trimmed.slice('/model '.length).trim();
    if (!nextModel) {
      return { handled: true, kind: 'message', message: 'Usage: /model <name>' };
    }

    args.setActiveModel(nextModel);
    return {
      handled: true,
      kind: 'message',
      message:
        knownModels.includes(nextModel) ?
          `Switched model to ${nextModel}`
        : `Switched model to ${nextModel}. This name is not in Heddle's common shortlist, so the next API call will fail if the provider does not recognize it.`,
    };
  }

  if (trimmed === '/clear') {
    args.clearConversation();
    return {
      handled: true,
      kind: 'message',
      message: 'Cleared the current chat transcript.',
    };
  }

  if (trimmed === '/continue') {
    return { handled: true, kind: 'continue' };
  }

  if (trimmed === '/session list') {
    return {
      handled: true,
      kind: 'message',
      message: args.sessions.length > 0 ? args.listRecentSessionsMessage.join('\n') : 'No sessions available.',
    };
  }

  if (trimmed.startsWith('/session new')) {
    const maybeName = trimmed.slice('/session new'.length).trim();
    const session = args.createSession(maybeName || undefined);
    return {
      handled: true,
      kind: 'message',
      message: `Created and switched to ${session.id} (${session.name}).`,
    };
  }

  if (trimmed.startsWith('/session switch ')) {
    const id = trimmed.slice('/session switch '.length).trim();
    const session = args.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return {
        handled: true,
        kind: 'message',
        message: `Unknown session: ${id}. Use /session list to inspect available sessions.`,
      };
    }
    args.switchSession(id);
    return {
      handled: true,
      kind: 'message',
      message: `Switched to ${session.id} (${session.name}).\n${summarizeSession(session)}`,
    };
  }

  if (trimmed.startsWith('/session continue ')) {
    const id = trimmed.slice('/session continue '.length).trim();
    const session = args.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return {
        handled: true,
        kind: 'message',
        message: `Unknown session: ${id}.\nUse /session list to inspect available sessions.`,
      };
    }
    return {
      handled: true,
      kind: 'continue',
      sessionId: id,
      message: `Switched to ${session.id} (${session.name}).\nContinuing from that session transcript.`,
    };
  }

  if (trimmed.startsWith('/session rename ')) {
    const name = trimmed.slice('/session rename '.length).trim();
    if (!name) {
      return { handled: true, kind: 'message', message: 'Usage: /session rename <name>' };
    }
    args.renameSession(name);
    return {
      handled: true,
      kind: 'message',
      message: `Renamed current session to ${name}.`,
    };
  }

  if (trimmed.startsWith('/session close ')) {
    const id = trimmed.slice('/session close '.length).trim();
    const session = args.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return {
        handled: true,
        kind: 'message',
        message: `Unknown session: ${id}.\nUse /session list to inspect available sessions.`,
      };
    }
    args.removeSession(id);
    return {
      handled: true,
      kind: 'message',
      message: `Closed ${session.id} (${session.name}).`,
    };
  }

  return {
    handled: true,
    kind: 'message',
    message: `Unknown command: ${trimmed}. Use /help for available commands.`,
  };
}
