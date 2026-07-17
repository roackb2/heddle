import type { ChatMessage } from '@/core/llm/types.js';
import type {
  ChatArchiveManifest,
  ChatArchiveRecord,
} from '@/core/chat/types.js';

export type FileChatArchiveRepositoryOptions = {
  stateRoot: string;
};

export type ChatArchiveStoragePaths = {
  sessionDir: string;
  archivesDir: string;
  manifestPath: string;
  displaySessionDir: string;
  displayArchivesDir: string;
};

export type ChatArchiveRecordDraft = Omit<ChatArchiveRecord, 'path' | 'summaryPath'>;

export type AppendChatArchiveInput = {
  sessionId: string;
  archive: ChatArchiveRecordDraft;
  messages: ChatMessage[];
  summary: string;
};

export type AppendChatArchiveResult = {
  archive: ChatArchiveRecord;
  manifest: ChatArchiveManifest;
};

/**
 * Host-provided durable storage for compacted conversation history.
 *
 * `path` and `summaryPath` on returned records are repository-owned opaque
 * locators. File adapters return inspectable `.heddle/...` paths; remote
 * adapters may return database or object-store keys.
 */
export type ChatArchiveRepository = {
  loadManifest(sessionId: string): Promise<ChatArchiveManifest>;
  readSummary(summaryLocator: string): Promise<string | undefined>;
  /**
   * Makes raw messages, their rolling summary, and the returned manifest
   * visible as one durable append. A rejected call must never leave a manifest
   * that references missing content; unreferenced orphan content is allowed.
   */
  append(input: AppendChatArchiveInput): Promise<AppendChatArchiveResult>;
};
