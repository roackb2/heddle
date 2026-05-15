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
  type ChatSessionRepository,
} from './repository/file-chat-session-repository.js';
import {
  createChatSession,
  createInitialMessages,
  isGenericSessionName,
  summarizeSession,
  touchSession,
} from './session-record.js';
import {
  acquireSessionLease,
  getSessionLeaseConflict,
  releaseSessionLease,
  type ChatSessionLeaseOwner,
} from './lease.js';
import { buildCompactionRunningContext } from '../history/compaction.js';
import { buildConversationMessages } from './conversation-lines.js';
import type { ChatSession } from '../../types.js';
import type { ConversationEngineConfig } from '../types.js';
import type { NormalizedConversationEngineConfig } from '../config.js';
import type {
  AppendConversationMessageInput,
  ApplyConversationCompactionResultInput,
  ConversationSessionService,
  CreateConversationSessionInput,
  MarkConversationCompactionRunningInput,
  ResetConversationSessionInput,
  RestoreConversationCompactionStateInput,
  UpdateConversationSessionSettingsInput,
} from '../types.js';

type ConversationSessionServiceConfig = Pick<
  ConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'workspaceId' | 'apiKeyPresent'
>;

type NormalizedConversationSessionServiceConfig = Pick<
  NormalizedConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'workspaceId' | 'apiKeyPresent'
>;

export function createConversationSessionService(args: {
  config: NormalizedConversationEngineConfig | ConversationSessionServiceConfig;
}): ConversationSessionService {
  return new FileConversationSessionService(normalizeConversationSessionServiceConfig(args.config));
}

export function summarizeConversationSession(session: ChatSession): string {
  return summarizeSession(session);
}

class FileConversationSessionService implements ConversationSessionService {
  private readonly repository: ChatSessionRepository;

  constructor(private readonly config: NormalizedConversationSessionServiceConfig) {
    this.repository = createFileChatSessionRepository({
      sessionStoragePath: config.sessionStoragePath,
    });
  }

  list(): ChatSession[] {
    return this.loadSessions();
  }

  read(id: string): ChatSession | undefined {
    return this.readSession(id);
  }

  require(id: string): ChatSession {
    const session = this.readSession(id);
    if (!session) {
      throw new Error(`Chat session not found: ${id}`);
    }
    return session;
  }

  latest(): ChatSession | undefined {
    return this.loadSessions()[0];
  }

  create(input?: CreateConversationSessionInput): ChatSession {
    const existing = this.loadSessions(input?.apiKeyPresent ?? this.config.apiKeyPresent);
    const session = createChatSession({
      id: input?.id?.trim() || `session-${Date.now()}`,
      name: input?.name?.trim() || `Session ${getNextSessionNumber(existing)}`,
      apiKeyPresent: input?.apiKeyPresent ?? this.config.apiKeyPresent,
      model: input?.model ?? this.config.model,
      reasoningEffort: input?.reasoningEffort ?? this.config.reasoningEffort,
      workspaceId: input?.workspaceId ?? this.config.workspaceId,
    });
    this.repository.save([session, ...existing]);
    return session;
  }

  update(id: string, updater: (session: ChatSession) => ChatSession): ChatSession | undefined {
    const sessions = this.loadSessions();
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return undefined;
    }

    const nextSession = updater(session);
    if (nextSession === session) {
      return session;
    }

    const touched = touchSession(nextSession);
    this.repository.save(sessions.map((candidate) => (candidate.id === id ? touched : candidate)));
    return touched;
  }

  updateSettings(id: string, input: UpdateConversationSessionSettingsInput): ChatSession {
    return this.updateRequiredSession(id, (session) => applySessionSettings(session, input));
  }

  appendMessage(id: string, input: AppendConversationMessageInput): ChatSession {
    return this.appendMessages(id, [input]);
  }

  appendMessages(id: string, inputs: AppendConversationMessageInput[]): ChatSession {
    if (inputs.length === 0) {
      return this.require(id);
    }

    return this.updateRequiredSession(id, (session) => ({
      ...session,
      messages: [...session.messages, ...inputs],
    }));
  }

  resetConversation(id: string, input: ResetConversationSessionInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      history: [],
      turns: [],
      lastContinuePrompt: undefined,
      messages: createInitialMessages(input.apiKeyPresent),
    }));
  }

  setLastContinuePrompt(id: string, prompt: string | undefined): ChatSession {
    return this.updateRequiredSession(id, (session) => (
      session.lastContinuePrompt === prompt ? session : {
        ...session,
        lastContinuePrompt: prompt,
      }
    ));
  }

  markCompactionRunning(id: string, input: MarkConversationCompactionRunningInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      history: input.sourceHistory,
      context: buildCompactionRunningContext({
        history: input.sourceHistory,
        previous: session.context,
        archiveCount: session.archives?.length,
        currentSummaryPath: session.context?.currentSummaryPath,
        lastArchivePath: input.archivePath,
      }),
    }));
  }

  applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      ...input,
      messages: buildConversationMessages(input.history),
    }));
  }

  restoreCompactionState(id: string, input: RestoreConversationCompactionStateInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      ...input,
    }));
  }

  setDriftEnabled(id: string, enabled: boolean): ChatSession {
    return this.updateRequiredSession(id, (session) => applySessionSettings(session, { driftEnabled: enabled }));
  }

  getLeaseConflict(id: string, owner: ChatSessionLeaseOwner): string | undefined {
    return getSessionLeaseConflict(this.require(id), owner);
  }

  acquireLease(id: string, owner: ChatSessionLeaseOwner): ChatSession {
    return this.updateRequiredSession(id, (session) => {
      const conflict = getSessionLeaseConflict(session, owner);
      if (conflict) {
        throw new Error(conflict);
      }

      return acquireSessionLease(session, owner);
    });
  }

  releaseLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession {
    return this.updateRequiredSession(id, (session) => releaseSessionLease(session, owner));
  }

  rename(id: string, name: string): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      name,
    }));
  }

  delete(id: string): boolean {
    const sessions = this.loadSessions();
    if (!sessions.some((candidate) => candidate.id === id)) {
      return false;
    }

    const remaining = sessions.filter((candidate) => candidate.id !== id);
    if (remaining.length > 0) {
      this.repository.save(remaining);
      return true;
    }

    this.repository.save([createFallbackSession(this.config)]);
    return true;
  }

  private loadSessions(apiKeyPresent = this.config.apiKeyPresent): ChatSession[] {
    const sessions = this.repository.list(apiKeyPresent);
    if (this.repository.readCatalog().length === 0) {
      const fallback = createFallbackSession(this.config, apiKeyPresent);
      this.repository.save([fallback]);
      return [fallback];
    }
    return sessions;
  }

  private readSession(id: string): ChatSession | undefined {
    return this.loadSessions().find((candidate) => candidate.id === id);
  }

  private updateRequiredSession(id: string, updater: (session: ChatSession) => ChatSession): ChatSession {
    const updated = this.update(id, updater);
    if (!updated) {
      throw new Error(`Chat session not found: ${id}`);
    }
    return updated;
  }
}

// Session mutation helpers.

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

// Configuration helpers.

function normalizeConversationSessionServiceConfig(
  config: NormalizedConversationEngineConfig | ConversationSessionServiceConfig,
): NormalizedConversationSessionServiceConfig {
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

// Session creation and naming helpers.

function createFallbackSession(
  config: Pick<NormalizedConversationSessionServiceConfig, 'model' | 'reasoningEffort' | 'workspaceId' | 'apiKeyPresent'>,
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
