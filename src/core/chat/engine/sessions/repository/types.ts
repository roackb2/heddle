import type { ReasoningEffort } from '@/core/llm/types.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession, ChatSessionLease, ChatSessionRetention } from '@/core/chat/types.js';

export type ChatSessionCatalogEntry = {
  id: string;
  name: string;
  retention?: ChatSessionRetention;
  workspaceId?: string;
  pinned: boolean;
  archivedAt?: string;
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

/**
 * Persistence port for chat sessions: the session catalog plus full session
 * bodies. Session/turn services own session policy (leases, records,
 * compaction state) and delegate persistence here, so a host can back
 * sessions with its own storage (database, object store, in-memory) by
 * implementing this contract and passing it to
 * `createConversationEngine({ sessionRepository })`.
 */
export type ChatSessionRepository = {
  list(): ChatSession[];
  readCatalog(): ChatSessionCatalogEntry[];
  read(sessionId: string): ChatSession | undefined;
  save(sessions: ChatSession[]): void;
};
