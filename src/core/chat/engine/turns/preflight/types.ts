import type { ChatMessage } from '@/core/llm/types.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession } from '@/core/chat/types.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatTurnHostBridge } from '../host/index.js';
import type { compactChatHistoryWithArchive } from '@/core/chat/engine/history/compaction.js';

export type ChatTurnPreflightCompactionStatus = {
  status: 'running' | 'finished' | 'failed';
  archivePath?: string;
  summaryPath?: string;
  error?: string;
};

export type PrepareChatSessionTurnArgs = {
  sessionStoragePath: string;
  sessionId: string;
  fallbackHistory: ChatMessage[];
  prompt: string;
  model: string;
  stateRoot: string;
  systemContext?: string;
  toolNames: string[];
  summarizer: Parameters<typeof compactChatHistoryWithArchive>[0]['summarizer'];
  leaseOwner: ChatSessionLeaseOwner;
  sessions: ChatSession[];
  hostBridge: Pick<ChatTurnHostBridge, 'notifyPreflightCompactionStatus'>;
};

export type PreflightTurnCompactionRuntime = Pick<
  PrepareChatSessionTurnArgs,
  'model' | 'stateRoot' | 'systemContext'
>;

export type PreflightTurnCompactionRequest = {
  toolNames: string[];
  goal: string;
};

export type PersistPreflightRunningSeedArgs = Pick<
  PrepareChatSessionTurnArgs,
  'sessionStoragePath' | 'sessions' | 'sessionId'
> & {
  leasedSession: ChatSession;
  archivePath?: string;
};

export type PersistPreparedChatSessionTurnArgs = Pick<
  PrepareChatSessionTurnArgs,
  'sessionStoragePath' | 'sessions'
> & {
  session: ChatSession;
  prepared: Extract<PrepareChatSessionTurnResult, { ok: true }>;
};

export type PrepareChatSessionTurnResult =
  | {
      ok: true;
      session?: ChatSession;
      historyForRun: ChatMessage[];
      preflightHistory: ChatMessage[];
      context: ChatContextStats;
      archives: ChatArchiveRecord[];
    }
  | {
      ok: false;
      reason: 'lease_conflict';
      message: string;
    };
