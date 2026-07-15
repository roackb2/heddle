import type { ReasoningEffort } from '@/core/llm/types.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession, ChatSessionLease, ChatSessionRetention } from '@/core/chat/types.js';

export type ChatSessionCatalogEntry = {
  id: string;
  /** Monotonic persistence revision used for optimistic concurrency. */
  revision: number;
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

export type StoredChatSession = {
  session: ChatSession;
  revision: number;
};

export type ListChatSessionsInput = {
  /**
   * Opaque adapter-owned cursor returned by the previous page. Adapters must
   * use the same stable order for sorting and cursor filtering: pinned first,
   * then updatedAt descending, then id ascending.
   */
  cursor?: string;
  limit: number;
  workspaceId?: string;
  archived?: boolean;
};

export type ChatSessionCatalogPage = {
  items: ChatSessionCatalogEntry[];
  nextCursor?: string;
};

export type UpdateChatSessionInput = {
  session: ChatSession;
  expectedRevision: number;
};

export type DeleteChatSessionInput = {
  sessionId: string;
  expectedRevision: number;
};

/**
 * Async persistence port for versioned chat-session records.
 *
 * Session/turn services own policy (leases, records, compaction state). An
 * adapter owns durable record I/O, deterministic cursor pagination, and atomic
 * expected-revision updates. Repository instances should already be scoped to
 * the host's tenant/workspace authorization boundary; Heddle deliberately does
 * not add product-specific user or RLS fields to this domain contract.
 */
export type ChatSessionRepository = {
  list(input: ListChatSessionsInput): Promise<ChatSessionCatalogPage>;
  read(sessionId: string): Promise<StoredChatSession | undefined>;
  create(session: ChatSession): Promise<StoredChatSession>;
  update(input: UpdateChatSessionInput): Promise<StoredChatSession | undefined>;
  delete(input: DeleteChatSessionInput): Promise<boolean>;
};
