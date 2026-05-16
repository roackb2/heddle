import type { ChatMessage } from '../../../../llm/types.js';
import type { ChatArchiveManifest } from '../../../types.js';

export type ChatArchivePaths = {
  sessionDir: string;
  archivesDir: string;
  manifestPath: string;
  displaySessionDir: string;
  displayArchivesDir: string;
};

export type ChatArchiveRepository = {
  derivePaths(): ChatArchivePaths;
  ensureArchiveDir(): ChatArchivePaths;
  loadManifest(): ChatArchiveManifest;
  saveManifest(manifest: ChatArchiveManifest): void;
  writeMessagesJsonl(archiveId: string, messages: ChatMessage[]): string;
  writeSummaryMarkdown(archiveId: string, summary: string): string;
  readSummaryMarkdown(path: string): string | undefined;
};
