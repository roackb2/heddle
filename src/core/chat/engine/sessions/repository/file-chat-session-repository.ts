/**
 * File-backed implementation of the versioned chat-session repository.
 *
 * Session bodies are immutable revision files. A body is fully written before
 * an atomically replaced catalog points at it, so readers observe either the
 * previous complete revision or the next complete revision. `proper-lockfile`
 * serializes compare-and-swap writes across repository instances/processes;
 * `async-mutex` avoids unnecessary lock contention within one instance.
 */
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Mutex } from 'async-mutex';
import { lock } from 'proper-lockfile';
import type { ChatSession } from '@/core/chat/types.js';
import { ChatSessionCatalogPagination } from './chat-session-catalog-pagination.js';
import { ChatSessionCodec } from './chat-session-codec.js';
import { ChatSessionPersistenceCodec } from './chat-session-persistence-codec.js';
import {
  ChatSessionAlreadyExistsError,
  ChatSessionRevisionConflictError,
  ChatSessionStorageCorruptionError,
} from './errors.js';
import type {
  ChatSessionCatalog,
  ChatSessionCatalogEntry,
  ChatSessionCatalogPage,
  ChatSessionRepository,
  DeleteChatSessionInput,
  ListChatSessionsInput,
  SessionStoragePaths,
  StoredChatSession,
  UpdateChatSessionInput,
} from './types.js';

export class FileChatSessionRepository implements ChatSessionRepository {
  private readonly sessionStoragePath: string;
  private readonly storagePaths: SessionStoragePaths;
  private readonly mutex = new Mutex();

  constructor(args: { sessionStoragePath: string }) {
    this.sessionStoragePath = args.sessionStoragePath;
    this.storagePaths = FileChatSessionRepository.deriveStoragePaths(args.sessionStoragePath);
  }

  async list(input: ListChatSessionsInput): Promise<ChatSessionCatalogPage> {
    return await this.mutex.runExclusive(async () => {
      ChatSessionCatalogPagination.validatePageLimit(input.limit);
      const catalog = await FileChatSessionRepository.readCatalogFile(this.storagePaths.catalogPath);
      const cursor = input.cursor
        ? ChatSessionCatalogPagination.decodeCursor(input.cursor)
        : undefined;
      const filtered = catalog.sessions
        .filter((entry) => input.workspaceId === undefined || entry.workspaceId === input.workspaceId)
        .filter((entry) => input.archived === undefined || Boolean(entry.archivedAt) === input.archived)
        .filter((entry) => !cursor || ChatSessionCatalogPagination.isAfterCursor(entry, cursor))
        .sort(ChatSessionCatalogPagination.compare);
      const items = filtered.slice(0, input.limit);
      const last = items.at(-1);

      return {
        items,
        nextCursor: filtered.length > input.limit && last
          ? ChatSessionCatalogPagination.encodeCursor(last)
          : undefined,
      };
    });
  }

  async read(sessionId: string): Promise<StoredChatSession | undefined> {
    return await this.mutex.runExclusive(async () => {
      const catalog = await FileChatSessionRepository.readCatalogFile(this.storagePaths.catalogPath);
      const entry = catalog.sessions.find((candidate) => candidate.id === sessionId);
      if (!entry) {
        return undefined;
      }

      return {
        session: await FileChatSessionRepository.readSessionFile(this.storagePaths.sessionsDir, entry),
        revision: entry.revision,
      };
    });
  }

  async create(session: ChatSession): Promise<StoredChatSession> {
    return await this.withWriteLock(async () => {
      const catalog = await FileChatSessionRepository.readCatalogFile(this.storagePaths.catalogPath);
      if (catalog.sessions.some((entry) => entry.id === session.id)) {
        throw new ChatSessionAlreadyExistsError(session.id);
      }

      const revision = 1;
      await FileChatSessionRepository.writeSessionRevision(this.storagePaths.sessionsDir, session, revision);
      const nextCatalog: ChatSessionCatalog = {
        version: 1,
        sessions: [
          ChatSessionPersistenceCodec.projectCatalogEntry(session, revision),
          ...catalog.sessions,
        ].sort(ChatSessionCatalogPagination.compare),
      };
      await FileChatSessionRepository.replaceCatalog(this.storagePaths.catalogPath, nextCatalog);
      return { session, revision };
    });
  }

  async update(input: UpdateChatSessionInput): Promise<StoredChatSession | undefined> {
    return await this.withWriteLock(async () => {
      const catalog = await FileChatSessionRepository.readCatalogFile(this.storagePaths.catalogPath);
      const current = catalog.sessions.find((entry) => entry.id === input.session.id);
      if (!current) {
        return undefined;
      }
      if (current.revision !== input.expectedRevision) {
        throw new ChatSessionRevisionConflictError(
          input.session.id,
          input.expectedRevision,
          current.revision,
        );
      }

      const revision = current.revision + 1;
      await FileChatSessionRepository.writeSessionRevision(
        this.storagePaths.sessionsDir,
        input.session,
        revision,
      );
      const nextCatalog: ChatSessionCatalog = {
        version: 1,
        sessions: catalog.sessions
          .map((entry) => entry.id === input.session.id
            ? ChatSessionPersistenceCodec.projectCatalogEntry(input.session, revision)
            : entry)
          .sort(ChatSessionCatalogPagination.compare),
      };
      await FileChatSessionRepository.replaceCatalog(this.storagePaths.catalogPath, nextCatalog);
      return { session: input.session, revision };
    });
  }

  async delete(input: DeleteChatSessionInput): Promise<boolean> {
    return await this.withWriteLock(async () => {
      const catalog = await FileChatSessionRepository.readCatalogFile(this.storagePaths.catalogPath);
      const current = catalog.sessions.find((entry) => entry.id === input.sessionId);
      if (!current) {
        return false;
      }
      if (current.revision !== input.expectedRevision) {
        throw new ChatSessionRevisionConflictError(
          input.sessionId,
          input.expectedRevision,
          current.revision,
        );
      }

      const nextCatalog: ChatSessionCatalog = {
        version: 1,
        sessions: catalog.sessions.filter((entry) => entry.id !== input.sessionId),
      };
      await FileChatSessionRepository.replaceCatalog(this.storagePaths.catalogPath, nextCatalog);
      return true;
    });
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
        catalogPath: storagePath,
        sessionsDir: join(stateDir, catalogStem),
      };
    }

    return {
      catalogPath: storagePath,
      sessionsDir: join(stateDir, fileName),
    };
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    return await this.mutex.runExclusive(async () => {
      await mkdir(dirname(this.sessionStoragePath), { recursive: true });
      await mkdir(this.storagePaths.sessionsDir, { recursive: true });
      const release = await lock(dirname(this.sessionStoragePath), {
        lockfilePath: `${this.sessionStoragePath}.lock`,
        realpath: false,
        stale: 30_000,
        update: 10_000,
        retries: {
          retries: 20,
          factor: 1.5,
          minTimeout: 10,
          maxTimeout: 500,
          randomize: true,
        },
      });

      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  private static async readCatalogFile(catalogPath: string): Promise<ChatSessionCatalog> {
    const contents = await FileChatSessionRepository.readOptionalFile(catalogPath);
    if (contents === undefined) {
      return { version: 1, sessions: [] };
    }

    try {
      const catalog = ChatSessionCodec.parseCatalog(JSON.parse(contents) as unknown);
      if (!catalog) {
        throw new Error('catalog schema validation failed');
      }
      return {
        ...catalog,
        sessions: catalog.sessions.sort(ChatSessionCatalogPagination.compare),
      };
    } catch (error) {
      throw new ChatSessionStorageCorruptionError(
        catalogPath,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private static async readSessionFile(
    sessionsDir: string,
    entry: ChatSessionCatalogEntry,
  ): Promise<ChatSession> {
    const revisionPath = FileChatSessionRepository.sessionRevisionPath(
      sessionsDir,
      entry.id,
      entry.revision,
    );
    const revisionContents = await FileChatSessionRepository.readOptionalFile(revisionPath);
    const legacyPath = FileChatSessionRepository.legacySessionPath(sessionsDir, entry.id);
    const contents = revisionContents ?? (
      entry.revision === 1
        ? await FileChatSessionRepository.readOptionalFile(legacyPath)
        : undefined
    );
    const path = revisionContents === undefined && entry.revision === 1 ? legacyPath : revisionPath;
    if (contents === undefined) {
      throw new ChatSessionStorageCorruptionError(path, 'referenced session body is missing');
    }

    try {
      const session = ChatSessionCodec.parseSessionBody(JSON.parse(contents) as unknown, { entry })[0];
      if (!session) {
        throw new Error('session body schema validation failed');
      }
      return session;
    } catch (error) {
      throw new ChatSessionStorageCorruptionError(
        path,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private static async writeSessionRevision(
    sessionsDir: string,
    session: ChatSession,
    revision: number,
  ): Promise<void> {
    await mkdir(sessionsDir, { recursive: true });
    const path = FileChatSessionRepository.sessionRevisionPath(sessionsDir, session.id, revision);
    await writeFile(path, ChatSessionCodec.serializeSessionBody(session));
  }

  private static async replaceCatalog(
    catalogPath: string,
    catalog: ChatSessionCatalog,
  ): Promise<void> {
    await mkdir(dirname(catalogPath), { recursive: true });
    const temporaryPath = `${catalogPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, ChatSessionCodec.serializeCatalog(catalog), { flag: 'wx' });
      await rename(temporaryPath, catalogPath);
    } finally {
      await FileChatSessionRepository.removeFileIfPresent(temporaryPath);
    }
  }

  private static async readOptionalFile(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (FileChatSessionRepository.isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private static async removeFileIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!FileChatSessionRepository.isMissingFileError(error)) {
        throw error;
      }
    }
  }

  private static isMissingFileError(error: unknown): boolean {
    return Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT',
    );
  }

  private static sessionRevisionPath(sessionsDir: string, sessionId: string, revision: number): string {
    return join(sessionsDir, `${encodeURIComponent(sessionId)}.${revision}.json`);
  }

  private static legacySessionPath(sessionsDir: string, sessionId: string): string {
    if (basename(sessionId) !== sessionId) {
      return FileChatSessionRepository.sessionRevisionPath(sessionsDir, sessionId, 1);
    }
    return join(sessionsDir, `${sessionId}.json`);
  }
}
