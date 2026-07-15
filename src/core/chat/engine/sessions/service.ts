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
 * The service owns session behavior and optimistic-concurrency coordination.
 * Repository adapters own atomic record persistence and pagination.
 */
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import dayjs from 'dayjs';
import {
  ChatSessionAlreadyExistsError,
  ChatSessionRevisionConflictError,
  FileChatSessionRepository,
} from '@/core/chat/engine/sessions/repository/index.js';
import type {
  ChatSessionCatalogEntry,
  ChatSessionCatalogPage,
  ChatSessionRepository,
  ListChatSessionsInput,
} from '@/core/chat/engine/sessions/repository/types.js';
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
  private static readonly defaultCatalogPageSize = 50;
  private static readonly maximumCatalogPageSize = 200;
  private static readonly maximumOptimisticUpdateRetries = 4;
  private readonly repository: ChatSessionRepository;
  private readonly config: NormalizedConversationSessionServiceConfig;

  constructor(config: NormalizedConversationEngineConfig | ConversationSessionServiceConfig) {
    this.config = FileConversationSessionService.normalizeConfig(config);
    this.repository = this.config.sessionRepository;
  }

  static summarize(session: ChatSession): string {
    return ChatSessionRecords.summarize(session);
  }

  async list(): Promise<ChatSession[]> {
    await this.ensureFallbackSession();
    return await this.listExisting();
  }

  async listCatalog(input: Partial<ListChatSessionsInput> = {}): Promise<ChatSessionCatalogPage> {
    await this.ensureFallbackSession();
    return await this.repository.list({
      cursor: input.cursor,
      limit: input.limit ?? FileConversationSessionService.defaultCatalogPageSize,
      workspaceId: input.workspaceId,
      archived: input.archived ?? false,
    });
  }

  async listExisting(): Promise<ChatSession[]> {
    const entries = await this.loadCatalogEntries({ archived: false });
    const records = await Promise.all(entries.map((entry) => this.repository.read(entry.id)));
    return records.flatMap((record) => record ? [record.session] : []);
  }

  async readExisting(id: string): Promise<ChatSession | undefined> {
    const record = await this.repository.read(id);
    return record?.session.archivedAt ? undefined : record?.session;
  }

  async read(id: string): Promise<ChatSession | undefined> {
    await this.ensureFallbackSession();
    return (await this.repository.read(id))?.session;
  }

  async require(id: string): Promise<ChatSession> {
    const session = await this.read(id);
    if (!session) {
      throw new Error(`Chat session not found: ${id}`);
    }
    return session;
  }

  async latest(): Promise<ChatSession | undefined> {
    return (await this.list())[0];
  }

  async latestExisting(): Promise<ChatSession | undefined> {
    return (await this.listExisting())[0];
  }

  async create(input?: CreateConversationSessionInput): Promise<ChatSession> {
    const existing = await this.loadCatalogEntries();
    const session = ChatSessionRecords.create({
      id: input?.id?.trim() || `session-${randomUUID()}`,
      name: input?.name?.trim() || `Session ${FileConversationSessionService.getNextSessionNumber(existing)}`,
      model: input?.model ?? this.config.model,
      reasoningEffort: input?.reasoningEffort ?? this.config.reasoningEffort,
      workspaceId: input?.workspaceId ?? this.config.workspaceId,
      retention: input?.retention,
    });
    return (await this.repository.create(session)).session;
  }

  async createOneOff(input?: CreateConversationSessionInput): Promise<ChatSession> {
    return await this.create({
      ...input,
      name: input?.name?.trim() || `Ask ${new Date().toISOString()}`,
      retention: 'one_off',
    });
  }

  async update(
    id: string,
    updater: (session: ChatSession) => ChatSession,
  ): Promise<ChatSession | undefined> {
    let conflictCount = 0;

    while (true) {
      const record = await this.repository.read(id);
      if (!record) {
        return undefined;
      }

      const nextSession = updater(record.session);
      if (nextSession === record.session) {
        return record.session;
      }

      try {
        const touched = ChatSessionRecords.touch(nextSession);
        return (await this.repository.update({
          session: touched,
          expectedRevision: record.revision,
        }))?.session;
      } catch (error) {
        if (
          !(error instanceof ChatSessionRevisionConflictError)
          || conflictCount >= FileConversationSessionService.maximumOptimisticUpdateRetries
        ) {
          throw error;
        }
        conflictCount += 1;
      }
    }
  }

  async updateSettings(id: string, input: UpdateConversationSessionSettingsInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => FileConversationSessionService.applySettings(session, input));
  }

  async appendMessage(id: string, input: AppendConversationMessageInput): Promise<ChatSession> {
    return await this.appendMessages(id, [input]);
  }

  async appendMessages(id: string, inputs: AppendConversationMessageInput[]): Promise<ChatSession> {
    if (inputs.length === 0) {
      return await this.require(id);
    }

    return await this.updateRequiredSession(id, (session) => ({
      ...session,
      messages: [...session.messages, ...inputs],
    }));
  }

  async markAcceptedUserMessage(id: string, input: MarkAcceptedConversationUserMessageInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => (
      ChatSessionRecords.markAcceptedUserMessage(session, input)
    ));
  }

  async acceptUserMessage(id: string, input: AcceptConversationUserMessageInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => {
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

  async markAcceptedUserMessageFailed(id: string, input: MarkAcceptedConversationUserMessageFailedInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => (
      ChatSessionRecords.markAcceptedUserMessageFailed(session, input)
    ));
  }

  async enqueuePrompt(id: string, input: EnqueueConversationPromptInput): Promise<QueuedConversationPromptResult> {
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
    const session = await this.updateRequiredSession(id, (current) => ({
      ...current,
      queuedPrompts: [...current.queuedPrompts, item],
    }));

    return {
      session,
      item,
      position: session.queuedPrompts.findIndex((candidate) => candidate.id === item.id) + 1,
    };
  }

  async updateQueuedPrompt(id: string, input: UpdateQueuedConversationPromptInput): Promise<ChatSession> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error('Queued prompt cannot be empty.');
    }

    return await this.updateRequiredSession(id, (session) => {
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

  async deleteQueuedPrompt(id: string, input: DeleteQueuedConversationPromptInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => {
      if (!session.queuedPrompts.some((item) => item.id === input.queueItemId)) {
        return session;
      }

      return {
        ...session,
        queuedPrompts: session.queuedPrompts.filter((item) => item.id !== input.queueItemId),
      };
    });
  }

  async dequeueQueuedPrompt(id: string): Promise<DequeuedConversationPromptResult> {
    let item: DequeuedConversationPromptResult['item'];
    const session = await this.updateRequiredSession(id, (current) => {
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

  async resetConversation(id: string): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ({
      ...session,
      history: [],
      turns: [],
      lastContinuePrompt: undefined,
      messages: [],
      queuedPrompts: [],
    }));
  }

  async setLastContinuePrompt(id: string, prompt: string | undefined): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => (
      session.lastContinuePrompt === prompt ? session : {
        ...session,
        lastContinuePrompt: prompt,
      }
    ));
  }

  async markCompactionRunning(id: string, input: MarkConversationCompactionRunningInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ({
      ...session,
      history: input.sourceHistory,
      context: ConversationCompactionService.buildSessionRunningContext({
        session,
        history: input.sourceHistory,
        lastArchivePath: input.archivePath,
      }),
    }));
  }

  async applyCompactionResult(id: string, input: ApplyConversationCompactionResultInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ({
      ...session,
      history: input.history,
      context: input.context,
      archives: input.archive.archives,
      messages: ConversationLines.fromHistory(input.history),
    }));
  }

  async restoreCompactionState(id: string, input: RestoreConversationCompactionStateInput): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ({
      ...session,
      ...input,
    }));
  }

  async setDriftEnabled(id: string, enabled: boolean): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => FileConversationSessionService.applySettings(session, { driftEnabled: enabled }));
  }

  async getLeaseConflict(id: string, owner: ChatSessionLeaseOwner): Promise<string | undefined> {
    return ChatSessionLeases.conflict(await this.require(id), owner);
  }

  async acquireLease(id: string, owner: ChatSessionLeaseOwner): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => {
      const conflict = ChatSessionLeases.conflict(session, owner);
      if (conflict) {
        throw new Error(conflict);
      }

      return ChatSessionLeases.acquire(session, owner);
    });
  }

  async refreshLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ChatSessionLeases.refresh(session, owner));
  }

  async releaseLease(id: string, owner: Pick<ChatSessionLeaseOwner, 'ownerId'>): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ChatSessionLeases.release(session, owner));
  }

  async rename(id: string, name: string): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => ({
      ...session,
      name,
    }));
  }

  async setPinned(id: string, pinned: boolean): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => (
      session.pinned === pinned ? session : {
        ...session,
        pinned,
      }
    ));
  }

  async setArchived(id: string, archived: boolean): Promise<ChatSession> {
    return await this.updateRequiredSession(id, (session) => {
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
    const session = await this.read(id);
    if (!session || !ChatSessionRecords.canAutoRenameAfterFirstUserMessage(session)) {
      return { renamed: false, session };
    }

    const title = await ChatSessionTitles.generate(input);
    if (!title) {
      return { renamed: false, session };
    }

    const latest = await this.require(id);
    if (!ChatSessionRecords.canAutoRenameAfterFirstUserMessage(latest)) {
      return { renamed: false, session: latest };
    }

    return {
      renamed: true,
      session: await this.rename(id, title),
    };
  }

  async delete(id: string): Promise<boolean> {
    const record = await this.repository.read(id);
    if (!record) {
      return false;
    }

    const deleted = await this.repository.delete({
      sessionId: id,
      expectedRevision: record.revision,
    });
    if (deleted) {
      await this.ensureFallbackSession();
    }
    return deleted;
  }

  private async updateRequiredSession(
    id: string,
    updater: (session: ChatSession) => ChatSession,
  ): Promise<ChatSession> {
    const updated = await this.update(id, updater);
    if (!updated) {
      throw new Error(`Chat session not found: ${id}`);
    }
    return updated;
  }

  private async ensureFallbackSession(): Promise<void> {
    const page = await this.repository.list({
      limit: 1,
    });
    if (page.items.length > 0) {
      return;
    }

    try {
      await this.repository.create(this.createFallbackSession());
    } catch (error) {
      if (!(error instanceof ChatSessionAlreadyExistsError)) {
        throw error;
      }
    }
  }

  private async loadCatalogEntries(
    filters: Pick<ListChatSessionsInput, 'archived' | 'workspaceId'> = {},
  ): Promise<ChatSessionCatalogEntry[]> {
    const entries: ChatSessionCatalogEntry[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.repository.list({
        ...filters,
        cursor,
        limit: FileConversationSessionService.maximumCatalogPageSize,
      });
      entries.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    return entries;
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

  private static getNextSessionNumber(sessions: Pick<ChatSession, 'name'>[]): number {
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
