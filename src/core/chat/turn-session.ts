import { loadChatSessions } from './storage.js';
import type { ChatSession } from './types.js';

export type LoadedChatTurnSession = {
  sessions: ChatSession[];
  session: ChatSession;
};

export function loadChatTurnSession(args: {
  sessionStoragePath: string;
  sessionId: string;
}): LoadedChatTurnSession {
  const sessions = loadChatSessions(args.sessionStoragePath, true);
  const session = sessions.find((candidate) => candidate.id === args.sessionId);
  if (!session) {
    throw new Error(`Chat session not found: ${args.sessionId}`);
  }

  return { sessions, session };
}
