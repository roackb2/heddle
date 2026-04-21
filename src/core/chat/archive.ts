import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from '../../index.js';
import type { ChatArchiveManifest, ChatArchiveRecord } from './types.js';

const ARCHIVE_MANIFEST_VERSION = 1;

export type ChatArchivePaths = {
  sessionDir: string;
  archivesDir: string;
  manifestPath: string;
  displaySessionDir: string;
  displayArchivesDir: string;
};

export function deriveChatArchivePaths(stateRoot: string, sessionId: string): ChatArchivePaths {
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

export function ensureChatArchiveDir(stateRoot: string, sessionId: string): ChatArchivePaths {
  const paths = deriveChatArchivePaths(stateRoot, sessionId);
  mkdirSync(paths.archivesDir, { recursive: true });
  return paths;
}

export function loadChatArchiveManifest(stateRoot: string, sessionId: string): ChatArchiveManifest {
  const paths = deriveChatArchivePaths(stateRoot, sessionId);
  if (!existsSync(paths.manifestPath)) {
    return {
      version: ARCHIVE_MANIFEST_VERSION,
      sessionId,
      archives: [],
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(paths.manifestPath, 'utf8')) as unknown;
    return parseChatArchiveManifest(parsed, sessionId);
  } catch {
    return {
      version: ARCHIVE_MANIFEST_VERSION,
      sessionId,
      archives: [],
    };
  }
}

export function saveChatArchiveManifest(stateRoot: string, sessionId: string, manifest: ChatArchiveManifest) {
  const paths = ensureChatArchiveDir(stateRoot, sessionId);
  writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function writeArchivedMessagesJsonl(stateRoot: string, sessionId: string, archiveId: string, messages: ChatMessage[]): string {
  const paths = ensureChatArchiveDir(stateRoot, sessionId);
  const displayPath = `${paths.displayArchivesDir}/${archiveId}.jsonl`;
  const filePath = join(paths.archivesDir, `${archiveId}.jsonl`);
  const body = messages.map((message, index) => JSON.stringify({
    index,
    ...message,
  })).join('\n');
  writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
  return displayPath;
}

export function writeArchiveSummaryMarkdown(
  stateRoot: string,
  sessionId: string,
  archiveId: string,
  summary: string,
): string {
  const paths = ensureChatArchiveDir(stateRoot, sessionId);
  const displayPath = `${paths.displayArchivesDir}/${archiveId}.summary.md`;
  const filePath = join(paths.archivesDir, `${archiveId}.summary.md`);
  writeFileSync(filePath, summary.endsWith('\n') ? summary : `${summary}\n`, 'utf8');
  return displayPath;
}

export function readArchiveSummaryMarkdown(path: string, stateRoot: string): string | undefined {
  const filePath = resolveDisplayPath(path, stateRoot);
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

export function createArchiveId(now = new Date()): string {
  return `archive-${now.toISOString().replaceAll(':', '-')}`;
}

export function updateChatArchiveManifest(
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

function parseChatArchiveManifest(value: unknown, sessionId: string): ChatArchiveManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: ARCHIVE_MANIFEST_VERSION, sessionId, archives: [] };
  }

  const candidate = value as Partial<ChatArchiveManifest> & { archives?: unknown };
  const archives =
    Array.isArray(candidate.archives) ?
      candidate.archives.flatMap(parseArchiveRecord)
    : [];

  return {
    version: ARCHIVE_MANIFEST_VERSION,
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : sessionId,
    currentSummaryPath: typeof candidate.currentSummaryPath === 'string' ? candidate.currentSummaryPath : undefined,
    archives,
  };
}

function parseArchiveRecord(value: unknown): ChatArchiveRecord[] {
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

function resolveDisplayPath(displayPath: string, stateRoot: string): string {
  if (displayPath.startsWith('.heddle/')) {
    return join(stateRoot, displayPath.slice('.heddle/'.length));
  }

  return displayPath;
}
