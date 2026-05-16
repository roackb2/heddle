import type { ReasoningEffort } from '../../../../llm/types.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession, ChatSessionLease, ChatSessionRetention } from '../../../types.js';

export type ChatSessionCatalogEntry = {
  id: string;
  name: string;
  retention?: ChatSessionRetention;
  workspaceId?: string;
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
  legacyPath: string;
  sessionsDir: string;
};

export type ChatSessionRepository = {
  list(apiKeyPresent: boolean): ChatSession[];
  readCatalog(): ChatSessionCatalogEntry[];
  read(sessionId: string, apiKeyPresent: boolean): ChatSession | undefined;
  migrateLegacy(apiKeyPresent: boolean): ChatSession[];
  save(sessions: ChatSession[]): void;
  deriveStoragePaths(): SessionStoragePaths;
};
