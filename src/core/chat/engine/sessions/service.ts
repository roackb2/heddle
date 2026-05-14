/**
 * Conversation session service.
 *
 * Boundary rule:
 * - hosts should call this service (or a later richer session service), not
 *   file-backed storage helpers directly;
 * - storage/repository code stays behind the service boundary;
 * - session semantics should grow here rather than leaking back into TUI/web
 *   host code.
 *
 * Current compromise:
 * this service currently uses the file-backed repository directly. That is the
 * intended direction for session persistence ownership, but some older host
 * flows still bypass the service and call the repository themselves. Those
 * flows should move inward to this service over time.
 */
import { join, resolve } from 'node:path';
import {
  createFileChatSessionRepository,
} from './repository/file-chat-session-repository.js';
import {
  createChatSession,
  isGenericSessionName,
  summarizeSession,
  touchSession,
} from './session-record.js';
import type { ChatSession } from '../../types.js';
import type { ConversationEngineConfig } from '../types.js';
import type { NormalizedConversationEngineConfig } from '../config.js';
import type {
  ConversationSessionService,
  UpdateConversationSessionSettingsInput,
} from '../types.js';

export function createConversationSessionService(args: {
  config: NormalizedConversationEngineConfig | ConversationSessionServiceConfig;
}): ConversationSessionService {
  const config = normalizeConversationSessionServiceConfig(args.config);
  const repository = createFileChatSessionRepository({
    sessionStoragePath: config.sessionStoragePath,
  });

  function loadSessions(apiKeyPresent = config.apiKeyPresent): ChatSession[] {
    const sessions = repository.list(apiKeyPresent);
    if (repository.readCatalog().length === 0) {
      const fallback = createFallbackSession(config, apiKeyPresent);
      repository.save([fallback]);
      return [fallback];
    }
    return sessions;
  }

  function readSession(id: string): ChatSession | undefined {
    return loadSessions().find((candidate) => candidate.id === id);
  }

  function requireSession(id: string): ChatSession {
    const session = readSession(id);
    if (!session) {
      throw new Error(`Chat session not found: ${id}`);
    }
    return session;
  }

  function updateSession(id: string, updater: (session: ChatSession) => ChatSession): ChatSession | undefined {
    const sessions = loadSessions();
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return undefined;
    }

    const nextSession = updater(session);
    if (nextSession === session) {
      return session;
    }

    const touched = touchSession(nextSession);
    repository.save(sessions.map((candidate) => (candidate.id === id ? touched : candidate)));
    return touched;
  }

  function updateRequiredSession(id: string, updater: (session: ChatSession) => ChatSession): ChatSession {
    const updated = updateSession(id, updater);
    if (!updated) {
      throw new Error(`Chat session not found: ${id}`);
    }
    return updated;
  }

  return {
    list() {
      return loadSessions();
    },
    read(id) {
      return readSession(id);
    },
    require(id) {
      return requireSession(id);
    },
    latest() {
      return loadSessions()[0];
    },
    create(input) {
      const existing = loadSessions(input?.apiKeyPresent ?? config.apiKeyPresent);
      const session = createChatSession({
        id: input?.id?.trim() || `session-${Date.now()}`,
        name: input?.name?.trim() || `Session ${getNextSessionNumber(existing)}`,
        apiKeyPresent: input?.apiKeyPresent ?? config.apiKeyPresent,
        model: input?.model ?? config.model,
        reasoningEffort: input?.reasoningEffort ?? config.reasoningEffort,
        workspaceId: input?.workspaceId ?? config.workspaceId,
      });
      repository.save([session, ...existing]);
      return session;
    },
    update(id, updater) {
      return updateSession(id, updater);
    },
    updateSettings(id, input) {
      return updateRequiredSession(id, (session) => applySessionSettings(session, input));
    },
    rename(id, name) {
      return updateRequiredSession(id, (session) => ({
        ...session,
        name,
      }));
    },
    delete(id) {
      const sessions = loadSessions();
      if (!sessions.some((candidate) => candidate.id === id)) {
        return false;
      }

      const remaining = sessions.filter((candidate) => candidate.id !== id);
      if (remaining.length > 0) {
        repository.save(remaining);
        return true;
      }

      repository.save([createFallbackSession(config)]);
      return true;
    },
  };
}

function applySessionSettings(
  session: ChatSession,
  input: UpdateConversationSessionSettingsInput,
): ChatSession {
  const model = input.model ?? session.model;
  const reasoningEffort = input.reasoningEffort === null ? undefined : input.reasoningEffort ?? session.reasoningEffort;
  const driftEnabled = input.driftEnabled ?? session.driftEnabled;

  if (
    model === session.model &&
    reasoningEffort === session.reasoningEffort &&
    driftEnabled === session.driftEnabled
  ) {
    return session;
  }

  return {
    ...session,
    model,
    reasoningEffort,
    driftEnabled,
  };
}

type ConversationSessionServiceConfig = Pick<
  ConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'workspaceId' | 'apiKeyPresent'
>;

function normalizeConversationSessionServiceConfig(
  config: NormalizedConversationEngineConfig | ConversationSessionServiceConfig,
): Pick<NormalizedConversationEngineConfig, 'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'workspaceId' | 'apiKeyPresent'> {
  if ('memoryDir' in config && 'traceDir' in config && 'memoryMaintenanceMode' in config) {
    return config;
  }

  const workspaceRoot = resolve(config.workspaceRoot);
  const stateRoot = resolve(config.stateRoot);
  return {
    workspaceRoot,
    stateRoot,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    sessionStoragePath: resolve(config.sessionStoragePath ?? join(stateRoot, 'chat-sessions.catalog.json')),
    workspaceId: config.workspaceId,
    apiKeyPresent: config.apiKeyPresent ?? false,
  };
}

function createFallbackSession(
  config: Pick<NormalizedConversationEngineConfig, 'model' | 'reasoningEffort' | 'workspaceId' | 'apiKeyPresent'>,
  apiKeyPresent = config.apiKeyPresent,
): ChatSession {
  return createChatSession({
    id: 'session-1',
    name: 'Session 1',
    apiKeyPresent,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    workspaceId: config.workspaceId,
  });
}

function getNextSessionNumber(sessions: ChatSession[]): number {
  const highestGenericNumber = sessions.reduce((highest, session) => {
    if (!isGenericSessionName(session.name)) {
      return highest;
    }

    const parsed = Number.parseInt(session.name.replace(/^Session\s+/, ''), 10);
    if (!Number.isFinite(parsed)) {
      return highest;
    }

    return Math.max(highest, parsed);
  }, 0);

  return highestGenericNumber + 1;
}

export function summarizeConversationSession(session: ChatSession): string {
  return summarizeSession(session);
}
