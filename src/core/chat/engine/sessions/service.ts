import { createChatSession, loadChatSessions, readChatSession, saveChatSessions, touchSession } from './storage.js';
import type { ChatSession } from '../../types.js';
import type { NormalizedConversationEngineConfig } from '../config.js';
import type { ConversationSessionService } from '../types.js';

export function createConversationSessionService(args: {
  config: NormalizedConversationEngineConfig;
}): ConversationSessionService {
  const { config } = args;

  function loadSessions(apiKeyPresent = config.apiKeyPresent): ChatSession[] {
    return loadChatSessions(config.sessionStoragePath, apiKeyPresent);
  }

  return {
    list() {
      return loadSessions();
    },
    read(id) {
      return readChatSession(config.sessionStoragePath, id, config.apiKeyPresent);
    },
    create(input) {
      const existing = loadSessions(input?.apiKeyPresent ?? config.apiKeyPresent);
      const nextNumber = existing.length + 1;
      const session = createChatSession({
        id: input?.id?.trim() || `session-${Date.now()}`,
        name: input?.name?.trim() || `Session ${nextNumber}`,
        apiKeyPresent: input?.apiKeyPresent ?? config.apiKeyPresent,
        model: input?.model ?? config.model,
        workspaceId: input?.workspaceId ?? config.workspaceId,
      });
      saveChatSessions(config.sessionStoragePath, [session, ...existing]);
      return session;
    },
    rename(id, name) {
      const sessions = loadSessions();
      const session = sessions.find((candidate) => candidate.id === id);
      if (!session) {
        throw new Error(`Chat session not found: ${id}`);
      }

      const renamed = touchSession({
        ...session,
        name,
      });
      saveChatSessions(config.sessionStoragePath, sessions.map((candidate) => (candidate.id === id ? renamed : candidate)));
      return renamed;
    },
    delete(id) {
      const sessions = loadSessions();
      if (!sessions.some((candidate) => candidate.id === id)) {
        return false;
      }

      saveChatSessions(config.sessionStoragePath, sessions.filter((candidate) => candidate.id !== id));
      return true;
    },
  };
}
