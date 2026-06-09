import type { ReasoningEffort } from '@/core/llm/types.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession, ChatSessionLease, ChatSessionRetention } from '@/core/chat/types.js';

export type ChatSessionCatalogEntry = {
  id: string;
  name: string;
  retention?: ChatSessionRetention;
  workspaceId?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  driftEnabled?: boolean;
  lastContinuePrompt?: string;
  context?: ChatContextStats;
  archives?: ChatArchiveRecord[];
  lease?: ChatSessionLease;
};

export type ChatSessionCatalog = {
  version: 1;
  sessions: ChatSessionCatalogEntry[];
};

export type SessionStoragePaths = {
  catalogPath: string;
  sessionsDir: string;
};

export type ChatSessionRepository = {
  list(): ChatSession[];
  readCatalog(): ChatSessionCatalogEntry[];
  read(sessionId: string): ChatSession | undefined;
  save(sessions: ChatSession[]): void;
  deriveStoragePaths(): SessionStoragePaths;
};
