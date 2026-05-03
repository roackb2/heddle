import { createChatSession, loadChatSessions, readChatSession, saveChatSessions, touchSession } from '../storage.js';
import type { ChatSession } from '../types.js';
import type { ConversationEngineConfig, ConversationSessionService } from './types.js';
import type { ConversationEnginePaths } from './paths.js';

export function createConversationSessionService(args: {
  config: ConversationEngineConfig;
  paths: ConversationEnginePaths;
}): ConversationSessionService {
  const { config, paths } = args;

  function loadSessions(apiKeyPresent = config.apiKeyPresent ?? Boolean(config.apiKey)): ChatSession[] {
    return loadChatSessions(paths.sessionStoragePath, apiKeyPresent);
  }

  return {
    list() {
      return loadSessions();
    },
    read(id) {
      return readChatSession(paths.sessionStoragePath, id, config.apiKeyPresent ?? Boolean(config.apiKey));
    },
    create(input) {
      const existing = loadSessions(input?.apiKeyPresent ?? config.apiKeyPresent ?? Boolean(config.apiKey));
      const nextNumber = existing.length + 1;
      const session = createChatSession({
        id: input?.id?.trim() || `session-${Date.now()}`,
        name: input?.name?.trim() || `Session ${nextNumber}`,
        apiKeyPresent: input?.apiKeyPresent ?? config.apiKeyPresent ?? Boolean(config.apiKey),
        model: input?.model ?? config.model,
        workspaceId: input?.workspaceId ?? config.workspaceId,
      });
      saveChatSessions(paths.sessionStoragePath, [session, ...existing]);
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
      saveChatSessions(paths.sessionStoragePath, sessions.map((candidate) => candidate.id === id ? renamed : candidate));
      return renamed;
    },
    delete(id) {
      const sessions = loadSessions();
      if (!sessions.some((candidate) => candidate.id === id)) {
        return false;
      }

      saveChatSessions(paths.sessionStoragePath, sessions.filter((candidate) => candidate.id !== id));
      return true;
    },
  };
}
