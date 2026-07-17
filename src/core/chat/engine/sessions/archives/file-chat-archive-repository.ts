/**
 * Async file-backed conversation archive repository.
 *
 * Exact transcript and summary files are written before an atomically replaced
 * manifest references them. `proper-lockfile` serializes manifest appends
 * across repository instances/processes; orphan files may remain after an
 * interrupted append, but a manifest never points at incomplete content.
 */
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Mutex } from 'async-mutex';
import { lock } from 'proper-lockfile';
import type { ChatArchiveRecord } from '@/core/chat/types.js';
import { ChatArchiveStorageCorruptionError } from './errors.js';
import { ChatArchivePersistenceCodec } from './persistence-codec.js';
import type {
  AppendChatArchiveInput,
  AppendChatArchiveResult,
  ChatArchiveRepository,
  ChatArchiveStoragePaths,
  FileChatArchiveRepositoryOptions,
} from './types.js';

export class FileChatArchiveRepository implements ChatArchiveRepository {
  private readonly stateRoot: string;
  private readonly mutex = new Mutex();

  constructor(options: FileChatArchiveRepositoryOptions) {
    this.stateRoot = resolve(options.stateRoot);
  }

  async loadManifest(sessionId: string) {
    return await FileChatArchiveRepository.readManifestFile(
      this.deriveStoragePaths(sessionId),
      sessionId,
    );
  }

  async readSummary(summaryLocator: string): Promise<string | undefined> {
    return await FileChatArchiveRepository.readOptionalFile(
      FileChatArchiveRepository.resolveDisplayPath(summaryLocator, this.stateRoot),
    );
  }

  async append(input: AppendChatArchiveInput): Promise<AppendChatArchiveResult> {
    return await this.withWriteLock(input.sessionId, async (paths) => {
      const manifest = await FileChatArchiveRepository.readManifestFile(paths, input.sessionId);
      const archiveFileStem = FileChatArchiveRepository.encodePathSegment(input.archive.id);
      const rawLocator = `${paths.displayArchivesDir}/${archiveFileStem}.jsonl`;
      const summaryLocator = `${paths.displayArchivesDir}/${archiveFileStem}.summary.md`;
      const archive: ChatArchiveRecord = {
        ...input.archive,
        path: rawLocator,
        summaryPath: summaryLocator,
      };
      const nextManifest = ChatArchivePersistenceCodec.appendArchive(manifest, archive);

      await writeFile(
        join(paths.archivesDir, `${archiveFileStem}.jsonl`),
        FileChatArchiveRepository.serializeMessages(input.messages),
        { flag: 'wx' },
      );
      await writeFile(
        join(paths.archivesDir, `${archiveFileStem}.summary.md`),
        input.summary.endsWith('\n') ? input.summary : `${input.summary}\n`,
        { flag: 'wx' },
      );
      await FileChatArchiveRepository.replaceManifest(paths.manifestPath, nextManifest);

      return {
        archive,
        manifest: nextManifest,
      };
    });
  }

  deriveStoragePaths(sessionId: string): ChatArchiveStoragePaths {
    return FileChatArchiveRepository.deriveStoragePaths(this.stateRoot, sessionId);
  }

  static deriveStoragePaths(stateRoot: string, sessionId: string): ChatArchiveStoragePaths {
    const sessionPathSegment = FileChatArchiveRepository.encodePathSegment(sessionId);
    const sessionDir = join(stateRoot, 'chat-sessions', sessionPathSegment);
    const archivesDir = join(sessionDir, 'archives');
    return {
      sessionDir,
      archivesDir,
      manifestPath: join(archivesDir, 'manifest.json'),
      displaySessionDir: `.heddle/chat-sessions/${sessionPathSegment}`,
      displayArchivesDir: `.heddle/chat-sessions/${sessionPathSegment}/archives`,
    };
  }

  private async withWriteLock<T>(
    sessionId: string,
    operation: (paths: ChatArchiveStoragePaths) => Promise<T>,
  ): Promise<T> {
    return await this.mutex.runExclusive(async () => {
      const paths = this.deriveStoragePaths(sessionId);
      await mkdir(paths.archivesDir, { recursive: true });
      const release = await lock(paths.archivesDir, {
        lockfilePath: `${paths.manifestPath}.lock`,
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
        return await operation(paths);
      } finally {
        await release();
      }
    });
  }

  private static async readManifestFile(
    paths: ChatArchiveStoragePaths,
    sessionId: string,
  ) {
    const contents = await FileChatArchiveRepository.readOptionalFile(paths.manifestPath);
    if (contents === undefined) {
      return ChatArchivePersistenceCodec.emptyManifest(sessionId);
    }

    try {
      return ChatArchivePersistenceCodec.parseManifest(JSON.parse(contents) as unknown, sessionId);
    } catch (error) {
      throw new ChatArchiveStorageCorruptionError(
        paths.manifestPath,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private static serializeMessages(messages: AppendChatArchiveInput['messages']): string {
    const body = messages.map((message, index) => JSON.stringify({
      index,
      ...message,
    })).join('\n');
    return body ? `${body}\n` : '';
  }

  private static async replaceManifest(
    manifestPath: string,
    manifest: AppendChatArchiveResult['manifest'],
  ): Promise<void> {
    const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        ChatArchivePersistenceCodec.serializeManifest(manifest),
        { flag: 'wx' },
      );
      await rename(temporaryPath, manifestPath);
    } finally {
      await FileChatArchiveRepository.removeFileIfPresent(temporaryPath);
    }
  }

  private static async readOptionalFile(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (FileChatArchiveRepository.isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private static async removeFileIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!FileChatArchiveRepository.isMissingFileError(error)) {
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

  private static encodePathSegment(value: string): string {
    const encoded = encodeURIComponent(value);
    return encoded === '.' || encoded === '..'
      ? encoded.replaceAll('.', '%2E')
      : encoded;
  }

  private static resolveDisplayPath(displayPath: string, stateRoot: string): string {
    if (!displayPath.startsWith('.heddle/')) {
      throw new ChatArchiveStorageCorruptionError(
        displayPath,
        'file archive summary locator must start with .heddle/',
      );
    }

    const filePath = resolve(stateRoot, displayPath.slice('.heddle/'.length));
    const relativePath = relative(stateRoot, filePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new ChatArchiveStorageCorruptionError(
        displayPath,
        'file archive summary locator escapes the configured state root',
      );
    }
    return filePath;
  }
}
