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
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/types.js';
import { ChatSessionLeases, type ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { buildSessionCompactionRunningContext } from '../history/compaction.js';
import { ChatSessionRecords, ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession } from '@/core/chat/types.js';
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
import type {
  ConversationSessionServiceConfig,
  NormalizedConversationSessionServiceConfig,
} from './types.js';

export class FileConversationSessionService implements ConversationSessionService {
  private readonly repository: ChatSessionRepository;
  private readonly config: NormalizedConversationSessionServiceConfig;

  constructor(config: NormalizedConversationEngineConfig | ConversationSessionServiceConfig) {
    this.config = FileConversationSessionService.normalizeConfig(config);
    this.repository = new FileChatSessionRepository({
      sessionStoragePath: this.config.sessionStoragePath,
    });
  }

  static summarize(session: ChatSession): string {
    return ChatSessionRecords.summarize(session);
  }

  list(): ChatSession[] {
    return this.loadSessions();
  }

  listExisting(): ChatSession[] {
    return this.loadExistingSessions();
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

  latestExisting(): ChatSession | undefined {
    return this.loadExistingSessions()[0];
  }

  create(input?: CreateConversationSessionInput): ChatSession {
    const existing = this.loadExistingSessions(input?.apiKeyPresent ?? this.config.apiKeyPresent);
    const session = ChatSessionRecords.create({
      id: input?.id?.trim() || `session-${Date.now()}`,
      name: input?.name?.trim() || `Session ${FileConversationSessionService.getNextSessionNumber(existing)}`,
      apiKeyPresent: input?.apiKeyPresent ?? this.config.apiKeyPresent,
      model: input?.model ?? this.config.model,
      reasoningEffort: input?.reasoningEffort ?? this.config.reasoningEffort,
      workspaceId: input?.workspaceId ?? this.config.workspaceId,
      retention: input?.retention,
    });
    this.repository.save([session, ...existing]);
    return session;
  }

  createOneOff(input?: CreateConversationSessionInput): ChatSession {
    return this.create({
      ...input,
      name: input?.name?.trim() || `Ask ${new Date().toISOString()}`,
      retention: 'one_off',
    });
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

    const touched = ChatSessionRecords.touch(nextSession);
    this.repository.save(sessions.map((candidate) => (candidate.id === id ? touched : candidate)));
    return touched;
  }

  updateSettings(id: string, input: UpdateConversationSessionSettingsInput): ChatSession {
    return this.updateRequiredSession(id, (session) => FileConversationSessionService.applySettings(session, input));
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
      messages: ChatSessionRecords.createInitialMessages(input.apiKeyPresent),
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
      context: buildSessionCompactionRunningContext({
        session,
        history: input.sourceHistory,
        lastArchivePath: input.archivePath,
      }),
    }));
  }

  applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      ...input,
      messages: ConversationLines.fromHistory(input.history),
    }));
  }

  restoreCompactionState(id: string, input: RestoreConversationCompactionStateInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      ...input,
    }));
  }

  setDriftEnabled(id: string, enabled: boolean): ChatSession {
    return this.updateRequiredSession(id, (session) => FileConversationSessionService.applySettings(session, { driftEnabled: enabled }));
  }

  getLeaseConflict(id: string, owner: ChatSessionLeaseOwner): string | undefined {
    return ChatSessionLeases.conflict(this.require(id), owner);
  }

  acquireLease(id: string, owner: ChatSessionLeaseOwner): ChatSession {
    return this.updateRequiredSession(id, (session) => {
      const conflict = ChatSessionLeases.conflict(session, owner);
      if (conflict) {
        throw new Error(conflict);
      }

      return ChatSessionLeases.acquire(session, owner);
    });
  }

  releaseLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession {
    return this.updateRequiredSession(id, (session) => ChatSessionLeases.release(session, owner));
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

    this.repository.save([this.createFallbackSession()]);
    return true;
  }

  private loadSessions(apiKeyPresent = this.config.apiKeyPresent): ChatSession[] {
    const sessions = this.repository.list(apiKeyPresent);
    if (this.repository.readCatalog().length === 0) {
      const fallback = this.createFallbackSession(apiKeyPresent);
      this.repository.save([fallback]);
      return [fallback];
    }
    return sessions;
  }

  private loadExistingSessions(apiKeyPresent = this.config.apiKeyPresent): ChatSession[] {
    const catalog = this.repository.readCatalog();
    if (catalog.length > 0) {
      return catalog
        .map((entry) => this.repository.read(entry.id, apiKeyPresent))
        .filter((session): session is ChatSession => Boolean(session));
    }

    return this.repository.migrateLegacy(apiKeyPresent);
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

  private createFallbackSession(apiKeyPresent = this.config.apiKeyPresent): ChatSession {
    return ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent,
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      workspaceId: this.config.workspaceId,
      retention: 'reusable',
    });
  }

  private static applySettings(
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

  private static normalizeConfig(
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

  private static getNextSessionNumber(sessions: ChatSession[]): number {
    const highestGenericNumber = sessions.reduce((highest, session) => {
      if (!ChatSessionRecords.isGenericName(session.name)) {
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
}
