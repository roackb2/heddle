/**
 * File-backed chat session repository.
 *
 * Owns file paths, migration, serialization, deserialization, and orphan-file
 * cleanup for chat sessions. Session services should depend on this class
 * rather than embedding file I/O logic themselves.
 *
 * Current compromise:
 * some older host or test paths still instantiate this repository directly.
 * The intended direction is host -> service -> repository -> files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ChatMessage } from '../../../../llm/types.js';
import type {
  ChatArchiveRecord,
  ChatContextStats,
  ChatSession,
  ChatSessionLease,
  ChatSessionRetention,
  ConversationLine,
  TurnSummary,
} from '../../../types.js';
import { ChatSessionRecords } from '../records/index.js';
import type { ChatSessionCatalog, ChatSessionCatalogEntry, ChatSessionRepository, SessionStoragePaths } from './types.js';

export class FileChatSessionRepository implements ChatSessionRepository {
  private readonly sessionStoragePath: string;
  private readonly storagePaths: SessionStoragePaths;

  constructor(args: { sessionStoragePath: string }) {
    this.sessionStoragePath = args.sessionStoragePath;
    this.storagePaths = FileChatSessionRepository.deriveStoragePaths(args.sessionStoragePath);
  }

  list(apiKeyPresent: boolean): ChatSession[] {
    const resolved = this.loadFromCurrentStorage(apiKeyPresent);
    if (resolved.length > 0) {
      return resolved;
    }

    const migrated = this.migrateLegacy(apiKeyPresent);
    if (migrated.length > 0) {
      return migrated;
    }

    return [
      ChatSessionRecords.create({
        id: 'session-1',
        name: 'Session 1',
        apiKeyPresent,
      }),
    ];
  }

  readCatalog(): ChatSessionCatalogEntry[] {
    const catalog = FileChatSessionRepository.readCatalogFile(this.deriveStoragePaths().catalogPath);
    return catalog?.sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) ?? [];
  }

  read(sessionId: string, apiKeyPresent: boolean): ChatSession | undefined {
    const paths = this.deriveStoragePaths();
    const catalog = FileChatSessionRepository.readCatalogFile(paths.catalogPath);
    const entry = catalog?.sessions.find((candidate) => candidate.id === sessionId);
    if (!entry) {
      return undefined;
    }

    return FileChatSessionRepository.readSessionFile(paths.sessionsDir, entry, apiKeyPresent)[0];
  }

  migrateLegacy(apiKeyPresent: boolean): ChatSession[] {
    const legacySessions = this.loadLegacy(apiKeyPresent);
    if (legacySessions.length === 0) {
      return [];
    }

    this.save(legacySessions);
    return legacySessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  save(sessions: ChatSession[]): void {
    mkdirSync(dirname(this.sessionStoragePath), { recursive: true });
    const paths = this.deriveStoragePaths();
    mkdirSync(paths.sessionsDir, { recursive: true });

    const sorted = FileChatSessionRepository.dedupeSessionsById(sessions)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const previousCatalog = FileChatSessionRepository.readCatalogFile(paths.catalogPath);
    const previousSessionBodies = new Map<string, string>();
    for (const entry of previousCatalog?.sessions ?? []) {
      const body = FileChatSessionRepository.readSessionFileContents(paths.sessionsDir, entry.id);
      if (body !== undefined) {
        previousSessionBodies.set(entry.id, body);
      }
    }

    for (const session of sorted) {
      FileChatSessionRepository.writeSessionFileIfChanged(
        paths.sessionsDir,
        session,
        previousSessionBodies.get(session.id),
      );
    }

    const catalog: ChatSessionCatalog = {
      version: 1,
      sessions: sorted.map((session) => FileChatSessionRepository.projectCatalogEntry(session)),
    };

    FileChatSessionRepository.writeCatalogIfChanged(paths.catalogPath, catalog, previousCatalog);
    FileChatSessionRepository.removeOrphanedSessionFiles(
      paths.sessionsDir,
      catalog.sessions.map((session) => session.id),
    );
  }

  deriveStoragePaths(): SessionStoragePaths {
    return this.storagePaths;
  }

  static deriveStoragePaths(storagePath: string): SessionStoragePaths {
    const stateDir = dirname(storagePath);
    const fileName = basename(storagePath);
    const catalogSuffix = '.catalog.json';
    const legacySuffix = '.json';

    if (fileName.endsWith(catalogSuffix)) {
      const catalogStem = fileName.slice(0, -catalogSuffix.length);
      return {
        // Current layout: preserve the configured catalog path exactly.
        catalogPath: storagePath,
        // Legacy fallback: older callers may still look for a flat JSON file.
        legacyPath: join(stateDir, `${catalogStem}${legacySuffix}`),
        sessionsDir: join(stateDir, catalogStem),
      };
    }

    if (fileName.endsWith(legacySuffix)) {
      const catalogStem = fileName.slice(0, -legacySuffix.length);
      return {
        // Current layout: upgrade legacy flat JSON paths to sibling catalog files.
        catalogPath: join(stateDir, `${catalogStem}${catalogSuffix}`),
        // Legacy fallback: keep reading and migrating from the original flat JSON path.
        legacyPath: storagePath,
        sessionsDir: join(stateDir, catalogStem),
      };
    }

    return {
      // Non-JSON inputs are already explicit. Preserve them without inventing
      // extra fallback paths.
      catalogPath: storagePath,
      legacyPath: storagePath,
      sessionsDir: join(stateDir, fileName),
    };
  }

  private loadFromCurrentStorage(apiKeyPresent: boolean): ChatSession[] {
    return this.loadSessionsFromCatalog(this.deriveStoragePaths(), apiKeyPresent);
  }

  private loadSessionsFromCatalog(paths: SessionStoragePaths, apiKeyPresent: boolean): ChatSession[] {
    if (!existsSync(paths.catalogPath)) {
      return [];
    }

    try {
      const raw = JSON.parse(readFileSync(paths.catalogPath, 'utf8')) as unknown;
      const catalog = FileChatSessionRepository.parseCatalog(raw);
      if (!catalog) {
        return [];
      }

      const sessions = catalog.sessions.flatMap((entry) =>
        FileChatSessionRepository.readSessionFile(paths.sessionsDir, entry, apiKeyPresent),
      );
      return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      process.stderr.write(
        `Failed to load chat session catalog from ${paths.catalogPath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return [];
    }
  }

  private loadLegacy(apiKeyPresent: boolean): ChatSession[] {
    try {
      if (!existsSync(this.sessionStoragePath)) {
        return [];
      }

      const raw = readFileSync(this.sessionStoragePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('Expected session array');
      }

      return parsed
        .flatMap((value) => FileChatSessionRepository.parseSavedSession(value, apiKeyPresent))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      process.stderr.write(
        `Failed to load chat sessions from ${this.sessionStoragePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return [];
    }
  }

  private static parseCatalog(value: unknown): ChatSessionCatalog | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const candidate = value as Partial<ChatSessionCatalog> & { sessions?: unknown };
    if (candidate.version !== 1 || !Array.isArray(candidate.sessions)) {
      return undefined;
    }

    const sessions = candidate.sessions.flatMap((entry) => FileChatSessionRepository.parseCatalogEntry(entry));
    return { version: 1, sessions };
  }

  private static parseCatalogEntry(value: unknown): ChatSessionCatalogEntry[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    const candidate = value as Partial<ChatSessionCatalogEntry>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
      return [];
    }

    const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
    const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

    return [{
      id: candidate.id,
      name: candidate.name,
      retention: FileChatSessionRepository.parseRetention(candidate.retention),
      workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : undefined,
      createdAt,
      updatedAt,
      model: typeof candidate.model === 'string' ? candidate.model : undefined,
      reasoningEffort:
        candidate.reasoningEffort === 'low' || candidate.reasoningEffort === 'medium' || candidate.reasoningEffort === 'high' || candidate.reasoningEffort === 'ultrahigh' ?
          candidate.reasoningEffort
        : undefined,
      driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : false,
      lastContinuePrompt: typeof candidate.lastContinuePrompt === 'string' ? candidate.lastContinuePrompt : undefined,
      context: FileChatSessionRepository.isChatContextStats(candidate.context) ? candidate.context : undefined,
      archives: Array.isArray(candidate.archives) ? candidate.archives.flatMap((archive) => FileChatSessionRepository.parseArchiveRecord(archive)) : undefined,
      lease: FileChatSessionRepository.parseLease(candidate.lease),
    }];
  }

  private static projectCatalogEntry(session: ChatSession): ChatSessionCatalogEntry {
    return {
      id: session.id,
      name: session.name,
      retention: session.retention,
      workspaceId: session.workspaceId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      driftEnabled: session.driftEnabled,
      lastContinuePrompt: session.lastContinuePrompt,
      context: session.context,
      archives: session.archives,
      lease: session.lease,
    };
  }

  private static readSessionFile(
    sessionsDir: string,
    entry: ChatSessionCatalogEntry,
    apiKeyPresent: boolean,
  ): ChatSession[] {
    const path = FileChatSessionRepository.sessionFilePath(sessionsDir, entry.id);
    if (!existsSync(path)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const payload = FileChatSessionRepository.readObjectRecord(parsed);
      if (!payload) {
        return [];
      }

      return [{
        id: entry.id,
        name: entry.name,
        retention: entry.retention,
        workspaceId: entry.workspaceId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        model: entry.model,
        reasoningEffort: entry.reasoningEffort,
        driftEnabled: entry.driftEnabled,
        lastContinuePrompt: entry.lastContinuePrompt,
        context: entry.context,
        archives: entry.archives,
        lease: entry.lease,
        history: Array.isArray(payload.history) ? payload.history as ChatMessage[] : [],
        messages:
          Array.isArray(payload.messages) && payload.messages.length > 0 ?
            payload.messages.filter((message) => FileChatSessionRepository.isConversationLine(message))
          : ChatSessionRecords.createInitialMessages(apiKeyPresent),
        turns: Array.isArray(payload.turns) ?
          payload.turns.filter((turn) => FileChatSessionRepository.isTurnSummary(turn))
        : [],
      }];
    } catch (error) {
      process.stderr.write(
        `Failed to load chat session file ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return [];
    }
  }

  private static writeSessionFileIfChanged(sessionsDir: string, session: ChatSession, previousContent?: string): void {
    const path = FileChatSessionRepository.sessionFilePath(sessionsDir, session.id);
    const nextContent = FileChatSessionRepository.serializeSessionBody(session);
    if (previousContent === nextContent) {
      return;
    }

    writeFileSync(path, nextContent);
  }

  private static writeCatalogIfChanged(
    catalogPath: string,
    catalog: ChatSessionCatalog,
    previousCatalog?: ChatSessionCatalog,
  ): void {
    const nextContent = `${JSON.stringify(catalog, null, 2)}\n`;
    const previousContent = previousCatalog ? `${JSON.stringify(previousCatalog, null, 2)}\n` : undefined;
    if (previousContent === nextContent) {
      return;
    }

    writeFileSync(catalogPath, nextContent);
  }

  private static serializeSessionBody(session: ChatSession): string {
    return `${JSON.stringify({
      id: session.id,
      retention: session.retention,
      workspaceId: session.workspaceId,
      history: session.history,
      messages: session.messages,
      turns: session.turns,
      archives: session.archives,
      lease: session.lease,
    }, null, 2)}\n`;
  }

  private static readSessionFileContents(sessionsDir: string, sessionId: string): string | undefined {
    const path = FileChatSessionRepository.sessionFilePath(sessionsDir, sessionId);
    if (!existsSync(path)) {
      return undefined;
    }

    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  }

  private static readCatalogFile(catalogPath: string): ChatSessionCatalog | undefined {
    if (!existsSync(catalogPath)) {
      return undefined;
    }

    try {
      return FileChatSessionRepository.parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
    } catch {
      return undefined;
    }
  }

  private static dedupeSessionsById(sessions: ChatSession[]): ChatSession[] {
    const seen = new Set<string>();
    const deduped: ChatSession[] = [];
    for (const session of sessions) {
      if (seen.has(session.id)) {
        continue;
      }

      seen.add(session.id);
      deduped.push(session);
    }

    return deduped;
  }

  private static sessionFilePath(sessionsDir: string, sessionId: string): string {
    return join(sessionsDir, `${sessionId}.json`);
  }

  private static removeOrphanedSessionFiles(sessionsDir: string, activeSessionIds: string[]): void {
    if (!existsSync(sessionsDir)) {
      return;
    }

    const allowed = new Set(activeSessionIds.map((id) => `${id}.json`));
    for (const name of FileChatSessionRepository.safeReadDirFiles(sessionsDir)) {
      if (allowed.has(name) || !name.endsWith('.json')) {
        continue;
      }

      unlinkSync(join(sessionsDir, name));
    }
  }

  private static safeReadDirFiles(path: string): string[] {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  }

  private static parseSavedSession(value: unknown, apiKeyPresent: boolean): ChatSession[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    const candidate = value as Partial<ChatSession>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
      return [];
    }

    const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
    const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

    return [{
      id: candidate.id,
      name: candidate.name,
      retention: FileChatSessionRepository.parseRetention(candidate.retention),
      workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : undefined,
      history: Array.isArray(candidate.history) ? candidate.history as ChatMessage[] : [],
      messages:
        Array.isArray(candidate.messages) && candidate.messages.length > 0 ?
          candidate.messages.filter((message) => FileChatSessionRepository.isConversationLine(message))
        : ChatSessionRecords.createInitialMessages(apiKeyPresent),
      turns: Array.isArray(candidate.turns) ?
        candidate.turns.filter((turn) => FileChatSessionRepository.isTurnSummary(turn))
      : [],
      createdAt,
      updatedAt,
      model: typeof candidate.model === 'string' ? candidate.model : undefined,
      reasoningEffort:
        candidate.reasoningEffort === 'low' || candidate.reasoningEffort === 'medium' || candidate.reasoningEffort === 'high' || candidate.reasoningEffort === 'ultrahigh' ?
          candidate.reasoningEffort
        : undefined,
      driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : false,
      lastContinuePrompt: typeof candidate.lastContinuePrompt === 'string' ? candidate.lastContinuePrompt : undefined,
      context: FileChatSessionRepository.isChatContextStats(candidate.context) ? candidate.context : undefined,
      archives: Array.isArray(candidate.archives) ? candidate.archives.flatMap((archive) => FileChatSessionRepository.parseArchiveRecord(archive)) : undefined,
      lease: FileChatSessionRepository.parseLease(candidate.lease),
    }];
  }

  private static parseRetention(value: unknown): ChatSessionRetention | undefined {
    return value === 'reusable' || value === 'one_off' ? value : undefined;
  }

  private static parseLease(value: unknown): ChatSessionLease | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const candidate = value as Partial<ChatSessionLease>;
    if (
      (candidate.ownerKind !== 'tui' && candidate.ownerKind !== 'daemon' && candidate.ownerKind !== 'ask') ||
      typeof candidate.ownerId !== 'string' ||
      typeof candidate.acquiredAt !== 'string' ||
      typeof candidate.lastSeenAt !== 'string'
    ) {
      return undefined;
    }

    return {
      ownerKind: candidate.ownerKind,
      ownerId: candidate.ownerId,
      acquiredAt: candidate.acquiredAt,
      lastSeenAt: candidate.lastSeenAt,
      clientLabel: typeof candidate.clientLabel === 'string' ? candidate.clientLabel : undefined,
    };
  }

  private static isConversationLine(value: unknown): value is ConversationLine {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Partial<ConversationLine>;
    return (
      typeof candidate.id === 'string' &&
      (candidate.role === 'user' || candidate.role === 'assistant') &&
      typeof candidate.text === 'string'
    );
  }

  private static isTurnSummary(value: unknown): value is TurnSummary {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Partial<TurnSummary>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.prompt === 'string' &&
      typeof candidate.outcome === 'string' &&
      typeof candidate.summary === 'string' &&
      typeof candidate.steps === 'number' &&
      typeof candidate.traceFile === 'string' &&
      Array.isArray(candidate.events) &&
      candidate.events.every((event) => typeof event === 'string')
    );
  }

  private static isChatContextStats(value: unknown): value is ChatContextStats {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Partial<ChatContextStats>;
    return (
      typeof candidate.estimatedHistoryTokens === 'number' &&
      (candidate.estimatedRequestTokens === undefined || typeof candidate.estimatedRequestTokens === 'number') &&
      (candidate.lastRunInputTokens === undefined || typeof candidate.lastRunInputTokens === 'number') &&
      (candidate.lastRunOutputTokens === undefined || typeof candidate.lastRunOutputTokens === 'number') &&
      (candidate.lastRunTotalTokens === undefined || typeof candidate.lastRunTotalTokens === 'number') &&
      (candidate.cachedInputTokens === undefined || typeof candidate.cachedInputTokens === 'number') &&
      (candidate.reasoningTokens === undefined || typeof candidate.reasoningTokens === 'number') &&
      (candidate.compactedMessages === undefined || typeof candidate.compactedMessages === 'number') &&
      (candidate.compactedAt === undefined || typeof candidate.compactedAt === 'string') &&
      (candidate.compactionStatus === undefined || candidate.compactionStatus === 'idle' || candidate.compactionStatus === 'running' || candidate.compactionStatus === 'failed') &&
      (candidate.compactionError === undefined || typeof candidate.compactionError === 'string') &&
      (candidate.archiveCount === undefined || typeof candidate.archiveCount === 'number') &&
      (candidate.currentSummaryPath === undefined || typeof candidate.currentSummaryPath === 'string') &&
      (candidate.lastArchivePath === undefined || typeof candidate.lastArchivePath === 'string')
    );
  }

  private static parseArchiveRecord(value: unknown): ChatArchiveRecord[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    const candidate = value as Partial<ChatArchiveRecord>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.path !== 'string'
      || typeof candidate.summaryPath !== 'string'
      || typeof candidate.messageCount !== 'number'
      || typeof candidate.createdAt !== 'string'
    ) {
      return [];
    }

    return [{
      id: candidate.id,
      path: candidate.path,
      summaryPath: candidate.summaryPath,
      shortDescription: typeof candidate.shortDescription === 'string' ? candidate.shortDescription : undefined,
      messageCount: candidate.messageCount,
      createdAt: candidate.createdAt,
      summaryModel: typeof candidate.summaryModel === 'string' ? candidate.summaryModel : undefined,
    }];
  }

  private static readObjectRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }
}
