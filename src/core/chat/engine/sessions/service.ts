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
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import dayjs from 'dayjs';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/types.js';
import { ChatSessionLeases, type ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { ChatSessionRecords, ChatSessionTitles, ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { NormalizedConversationEngineConfig } from '../config.js';
import type {
  AppendConversationMessageInput,
  AcceptConversationUserMessageInput,
  AutoRenameConversationSessionInput,
  AutoRenameConversationSessionResult,
  DeleteQueuedConversationPromptInput,
  DequeuedConversationPromptResult,
  EnqueueConversationPromptInput,
  ApplyConversationCompactionResultInput,
  ConversationSessionService,
  CreateConversationSessionInput,
  MarkAcceptedConversationUserMessageFailedInput,
  MarkAcceptedConversationUserMessageInput,
  MarkConversationCompactionRunningInput,
  RestoreConversationCompactionStateInput,
  QueuedConversationPromptResult,
  UpdateConversationSessionSettingsInput,
  UpdateQueuedConversationPromptInput,
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
    this.repository = this.config.sessionRepository;
  }

  static summarize(session: ChatSession): string {
    return ChatSessionRecords.summarize(session);
  }

  list(): ChatSession[] {
    return FileConversationSessionService.activeSessions(this.loadSessions());
  }

  listExisting(): ChatSession[] {
    return FileConversationSessionService.activeSessions(this.loadExistingSessions());
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
    return this.list()[0];
  }

  latestExisting(): ChatSession | undefined {
    return this.listExisting()[0];
  }

  create(input?: CreateConversationSessionInput): ChatSession {
    const existing = this.loadExistingSessions();
    const session = ChatSessionRecords.create({
      id: input?.id?.trim() || `session-${randomUUID()}`,
      name: input?.name?.trim() || `Session ${FileConversationSessionService.getNextSessionNumber(existing)}`,
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

  markAcceptedUserMessage(id: string, input: MarkAcceptedConversationUserMessageInput): ChatSession {
    return this.updateRequiredSession(id, (session) => (
      ChatSessionRecords.markAcceptedUserMessage(session, input)
    ));
  }

  acceptUserMessage(id: string, input: AcceptConversationUserMessageInput): ChatSession {
    return this.updateRequiredSession(id, (session) => {
      const conflict = ChatSessionLeases.conflict(session, input.leaseOwner);
      if (conflict) {
        throw new Error(conflict);
      }

      return ChatSessionRecords.markAcceptedUserMessage(
        ChatSessionLeases.acquire(session, input.leaseOwner),
        input,
      );
    });
  }

  markAcceptedUserMessageFailed(id: string, input: MarkAcceptedConversationUserMessageFailedInput): ChatSession {
    return this.updateRequiredSession(id, (session) => (
      ChatSessionRecords.markAcceptedUserMessageFailed(session, input)
    ));
  }

  enqueuePrompt(id: string, input: EnqueueConversationPromptInput): QueuedConversationPromptResult {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Queued prompt cannot be empty.');
    }

    const now = new Date().toISOString();
    const item = {
      id: `queued-prompt-${randomUUID()}`,
      prompt,
      agentProfileId: input.agentProfileId,
      agentSnapshot: input.agentSnapshot,
      systemContext: input.systemContext,
      createdAt: now,
      updatedAt: now,
    };
    const session = this.updateRequiredSession(id, (current) => ({
      ...current,
      queuedPrompts: [...current.queuedPrompts, item],
    }));

    return {
      session,
      item,
      position: session.queuedPrompts.findIndex((candidate) => candidate.id === item.id) + 1,
    };
  }

  updateQueuedPrompt(id: string, input: UpdateQueuedConversationPromptInput): ChatSession {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Queued prompt cannot be empty.');
    }

    return this.updateRequiredSession(id, (session) => {
      if (!session.queuedPrompts.some((item) => item.id === input.queueItemId)) {
        throw new Error(`Queued prompt not found: ${input.queueItemId}`);
      }

      return {
        ...session,
        queuedPrompts: session.queuedPrompts.map((item) => (
          item.id === input.queueItemId
            ? { ...item, prompt, updatedAt: new Date().toISOString() }
            : item
        )),
      };
    });
  }

  deleteQueuedPrompt(id: string, input: DeleteQueuedConversationPromptInput): ChatSession {
    return this.updateRequiredSession(id, (session) => {
      if (!session.queuedPrompts.some((item) => item.id === input.queueItemId)) {
        return session;
      }

      return {
        ...session,
        queuedPrompts: session.queuedPrompts.filter((item) => item.id !== input.queueItemId),
      };
    });
  }

  dequeueQueuedPrompt(id: string): DequeuedConversationPromptResult {
    let item: DequeuedConversationPromptResult['item'];
    const session = this.updateRequiredSession(id, (current) => {
      if (current.queuedPrompts.length === 0) {
        return current;
      }

      item = current.queuedPrompts[0];
      return {
        ...current,
        queuedPrompts: current.queuedPrompts.slice(1),
      };
    });

    return {
      session,
      item,
    };
  }

  resetConversation(id: string): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      history: [],
      turns: [],
      lastContinuePrompt: undefined,
      messages: [],
      queuedPrompts: [],
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
      context: ConversationCompactionService.buildSessionRunningContext({
        session,
        history: input.sourceHistory,
        lastArchivePath: input.archivePath,
      }),
    }));
  }

  applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): ChatSession {
    return this.updateRequiredSession(id, (session) => ({
      ...session,
      history: input.history,
      context: input.context,
      archives: input.archive.archives,
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

  refreshLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): ChatSession {
    return this.updateRequiredSession(id, (session) => ChatSessionLeases.refresh(session, owner));
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

  setPinned(id: string, pinned: boolean): ChatSession {
    return this.updateRequiredSession(id, (session) => (
      session.pinned === pinned ? session : {
        ...session,
        pinned,
      }
    ));
  }

  setArchived(id: string, archived: boolean): ChatSession {
    return this.updateRequiredSession(id, (session) => {
      if (archived) {
        return session.archivedAt ? session : {
          ...session,
          archivedAt: dayjs().toISOString(),
        };
      }

      return session.archivedAt === undefined ? session : {
        ...session,
        archivedAt: undefined,
      };
    });
  }

  async autoRenameAfterFirstUserMessage(
    id: string,
    input: AutoRenameConversationSessionInput,
  ): Promise<AutoRenameConversationSessionResult> {
    const session = this.read(id);
    if (!session || !ChatSessionRecords.canAutoRenameAfterFirstUserMessage(session)) {
      return { renamed: false, session };
    }

    const title = await ChatSessionTitles.generate(input);
    if (!title) {
      return { renamed: false, session };
    }

    const latest = this.require(id);
    if (!ChatSessionRecords.canAutoRenameAfterFirstUserMessage(latest)) {
      return { renamed: false, session: latest };
    }

    return {
      renamed: true,
      session: this.rename(id, title),
    };
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

  private loadSessions(): ChatSession[] {
    const sessions = this.repository.list();
    if (this.repository.readCatalog().length === 0) {
      const fallback = this.createFallbackSession();
      this.repository.save([fallback]);
      return [fallback];
    }
    return sessions;
  }

  private static activeSessions(sessions: ChatSession[]): ChatSession[] {
    return sessions.filter((session) => !session.archivedAt);
  }

  private loadExistingSessions(): ChatSession[] {
    const catalog = this.repository.readCatalog();
    if (catalog.length > 0) {
      return catalog
        .map((entry) => this.repository.read(entry.id))
        .filter((session): session is ChatSession => Boolean(session));
    }

    return [];
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

  private createFallbackSession(): ChatSession {
    return ChatSessionRecords.create({
      id: 'session-1',
      name: 'Session 1',
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
    const sessionStoragePath = resolve(config.sessionStoragePath ?? join(stateRoot, 'chat-sessions.catalog.json'));
    return {
      workspaceRoot,
      stateRoot,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      sessionStoragePath,
      sessionRepository: config.sessionRepository ?? new FileChatSessionRepository({ sessionStoragePath }),
      workspaceId: config.workspaceId,
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
