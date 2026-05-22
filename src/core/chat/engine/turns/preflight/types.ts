import type { ChatMessage } from '@/core/llm/types.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ConversationCompactionStatus } from '@/core/live/index.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatTurnHostPort } from '../host/index.js';
import type {
  ConversationCompactionResult,
  ConversationCompactionOptions,
} from '@/core/chat/engine/compaction/index.js';

export type ChatTurnPreflightCompactionStatus = ConversationCompactionStatus;

export type PrepareChatSessionTurnArgs = {
  sessionStoragePath: string;
  sessionId: string;
  fallbackHistory: ChatMessage[];
  prompt: string;
  model: string;
  stateRoot: string;
  systemContext?: string;
  toolNames: string[];
  summarizer: ConversationCompactionOptions['summarizer'];
  leaseOwner: ChatSessionLeaseOwner;
  sessions: ChatSession[];
  host: Pick<ChatTurnHostPort, 'onCompactionStatus'>;
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
  compacted: ConversationCompactionResult;
};

export type PrepareChatSessionTurnResult =
  | {
      ok: true;
      session: ChatSession;
      compacted: ConversationCompactionResult;
    }
  | {
      ok: false;
      reason: 'lease_conflict';
      message: string;
    };
