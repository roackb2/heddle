/**
 * File-backed chat archive repository.
 *
 * Owns archive paths, manifest persistence, archived transcript files, and
 * rolling-summary markdown files for one chat session. Compaction policy stays
 * in the history module; archive file layout stays here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from '../../../../llm/types.js';
import type { ChatArchiveManifest, ChatArchiveRecord } from '../../../types.js';
import type { ChatArchivePaths, ChatArchiveRepository } from './types.js';

const ARCHIVE_MANIFEST_VERSION = 1;

export class FileChatArchiveRepository implements ChatArchiveRepository {
  private readonly stateRoot: string;
  private readonly sessionId: string;
  private readonly paths: ChatArchivePaths;

  constructor(args: { stateRoot: string; sessionId: string }) {
    this.stateRoot = args.stateRoot;
    this.sessionId = args.sessionId;
    this.paths = FileChatArchiveRepository.derivePaths(args.stateRoot, args.sessionId);
  }

  derivePaths(): ChatArchivePaths {
    return this.paths;
  }

  ensureArchiveDir(): ChatArchivePaths {
    mkdirSync(this.paths.archivesDir, { recursive: true });
    return this.paths;
  }

  loadManifest(): ChatArchiveManifest {
    if (!existsSync(this.paths.manifestPath)) {
      return FileChatArchiveRepository.emptyManifest(this.sessionId);
    }

    try {
      const parsed = JSON.parse(readFileSync(this.paths.manifestPath, 'utf8')) as unknown;
      return FileChatArchiveRepository.parseManifest(parsed, this.sessionId);
    } catch {
      return FileChatArchiveRepository.emptyManifest(this.sessionId);
    }
  }

  saveManifest(manifest: ChatArchiveManifest): void {
    const paths = this.ensureArchiveDir();
    writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  writeMessagesJsonl(archiveId: string, messages: ChatMessage[]): string {
    const paths = this.ensureArchiveDir();
    const displayPath = `${paths.displayArchivesDir}/${archiveId}.jsonl`;
    const filePath = join(paths.archivesDir, `${archiveId}.jsonl`);
    const body = messages.map((message, index) => JSON.stringify({
      index,
      ...message,
    })).join('\n');
    writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
    return displayPath;
  }

  writeSummaryMarkdown(archiveId: string, summary: string): string {
    const paths = this.ensureArchiveDir();
    const displayPath = `${paths.displayArchivesDir}/${archiveId}.summary.md`;
    const filePath = join(paths.archivesDir, `${archiveId}.summary.md`);
    writeFileSync(filePath, summary.endsWith('\n') ? summary : `${summary}\n`, 'utf8');
    return displayPath;
  }

  readSummaryMarkdown(path: string): string | undefined {
    const filePath = FileChatArchiveRepository.resolveDisplayPath(path, this.stateRoot);
    if (!existsSync(filePath)) {
      return undefined;
    }

    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return undefined;
    }
  }

  static derivePaths(stateRoot: string, sessionId: string): ChatArchivePaths {
    const sessionDir = join(stateRoot, 'chat-sessions', sessionId);
    const archivesDir = join(sessionDir, 'archives');
    return {
      sessionDir,
      archivesDir,
      manifestPath: join(archivesDir, 'manifest.json'),
      displaySessionDir: `.heddle/chat-sessions/${sessionId}`,
      displayArchivesDir: `.heddle/chat-sessions/${sessionId}/archives`,
    };
  }

  static createArchiveId(now = new Date()): string {
    return `archive-${now.toISOString().replaceAll(':', '-')}`;
  }

  static appendManifestArchive(
    current: ChatArchiveManifest,
    archive: ChatArchiveRecord,
  ): ChatArchiveManifest {
    return {
      version: ARCHIVE_MANIFEST_VERSION,
      sessionId: current.sessionId,
      currentSummaryPath: archive.summaryPath,
      archives: [...current.archives, archive],
    };
  }

  private static emptyManifest(sessionId: string): ChatArchiveManifest {
    return {
      version: ARCHIVE_MANIFEST_VERSION,
      sessionId,
      archives: [],
    };
  }

  private static parseManifest(value: unknown, sessionId: string): ChatArchiveManifest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return FileChatArchiveRepository.emptyManifest(sessionId);
    }

    const candidate = value as Partial<ChatArchiveManifest> & { archives?: unknown };
    const archives =
      Array.isArray(candidate.archives) ?
        candidate.archives.flatMap((archive) => FileChatArchiveRepository.parseArchiveRecord(archive))
      : [];

    return {
      version: ARCHIVE_MANIFEST_VERSION,
      sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : sessionId,
      currentSummaryPath: typeof candidate.currentSummaryPath === 'string' ? candidate.currentSummaryPath : undefined,
      archives,
    };
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

  private static resolveDisplayPath(displayPath: string, stateRoot: string): string {
    if (displayPath.startsWith('.heddle/')) {
      return join(stateRoot, displayPath.slice('.heddle/'.length));
    }

    return displayPath;
  }
}
