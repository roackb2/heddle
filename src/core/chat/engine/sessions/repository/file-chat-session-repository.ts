/**
 * File-backed chat session repository.
 *
 * Owns file paths, serialization, deserialization, and orphan-file cleanup for
 * chat sessions. Session services should depend on this class rather than
 * embedding file I/O logic themselves.
 *
 * Current compromise:
 * some older host or test paths still instantiate this repository directly.
 * The intended direction is host -> service -> repository -> files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ChatSession } from '@/core/chat/types.js';
import { ChatSessionRecords } from '../records/index.js';
import { ChatSessionCodec } from './chat-session-codec.js';
import type { ChatSessionCatalog, ChatSessionCatalogEntry, ChatSessionRepository, SessionStoragePaths } from './types.js';

export class FileChatSessionRepository implements ChatSessionRepository {
  private readonly sessionStoragePath: string;
  private readonly storagePaths: SessionStoragePaths;

  constructor(args: { sessionStoragePath: string }) {
    this.sessionStoragePath = args.sessionStoragePath;
    this.storagePaths = FileChatSessionRepository.deriveStoragePaths(args.sessionStoragePath);
  }

  list(): ChatSession[] {
    const resolved = this.loadFromCurrentStorage();
    if (resolved.length > 0) {
      return resolved;
    }

    return [
      ChatSessionRecords.create({
        id: 'session-1',
        name: 'Session 1',
      }),
    ];
  }

  readCatalog(): ChatSessionCatalogEntry[] {
    const catalog = FileChatSessionRepository.readCatalogFile(this.deriveStoragePaths().catalogPath);
    return catalog?.sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) ?? [];
  }

  read(sessionId: string): ChatSession | undefined {
    const paths = this.deriveStoragePaths();
    const catalog = FileChatSessionRepository.readCatalogFile(paths.catalogPath);
    const entry = catalog?.sessions.find((candidate) => candidate.id === sessionId);
    if (!entry) {
      return undefined;
    }

    return FileChatSessionRepository.readSessionFile(paths.sessionsDir, entry)[0];
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
      sessions: sorted.map((session) => ChatSessionCodec.projectCatalogEntry(session)),
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

    if (fileName.endsWith(catalogSuffix)) {
      const catalogStem = fileName.slice(0, -catalogSuffix.length);
      return {
        // Current layout: preserve the configured catalog path exactly.
        catalogPath: storagePath,
        sessionsDir: join(stateDir, catalogStem),
      };
    }

    return {
      // Non-standard inputs are explicit catalog paths. Preserve them without
      // scanning sibling files or trying to upgrade older layouts.
      catalogPath: storagePath,
      sessionsDir: join(stateDir, fileName),
    };
  }

  private loadFromCurrentStorage(): ChatSession[] {
    return this.loadSessionsFromCatalog(this.deriveStoragePaths());
  }

  private loadSessionsFromCatalog(paths: SessionStoragePaths): ChatSession[] {
    if (!existsSync(paths.catalogPath)) {
      return [];
    }

    try {
      const raw = JSON.parse(readFileSync(paths.catalogPath, 'utf8')) as unknown;
      const catalog = ChatSessionCodec.parseCatalog(raw);
      if (!catalog) {
        return [];
      }

      const sessions = catalog.sessions.flatMap((entry) =>
        FileChatSessionRepository.readSessionFile(paths.sessionsDir, entry),
      );
      return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      process.stderr.write(
        `Failed to load chat session catalog from ${paths.catalogPath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return [];
    }
  }

  private static readSessionFile(
    sessionsDir: string,
    entry: ChatSessionCatalogEntry,
  ): ChatSession[] {
    const path = FileChatSessionRepository.sessionFilePath(sessionsDir, entry.id);
    if (!existsSync(path)) {
      return [];
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      return ChatSessionCodec.parseSessionBody(parsed, { entry });
    } catch (error) {
      process.stderr.write(
        `Failed to load chat session file ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return [];
    }
  }

  private static writeSessionFileIfChanged(sessionsDir: string, session: ChatSession, previousContent?: string): void {
    const path = FileChatSessionRepository.sessionFilePath(sessionsDir, session.id);
    const nextContent = ChatSessionCodec.serializeSessionBody(session);
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
    const nextContent = ChatSessionCodec.serializeCatalog(catalog);
    const previousContent = previousCatalog ? ChatSessionCodec.serializeCatalog(previousCatalog) : undefined;
    if (previousContent === nextContent) {
      return;
    }

    writeFileSync(catalogPath, nextContent);
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
      return ChatSessionCodec.parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
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

}
