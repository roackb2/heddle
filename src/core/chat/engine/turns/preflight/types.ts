import type { ChatMessage } from '@/core/llm/types.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ConversationCompactionStatus } from '@/core/live/index.js';
import type {
  ChatSessionLeaseClaim,
  ChatSessionLeaseOwner,
} from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';
import type { ChatTurnHostPort } from '../host/index.js';
import type {
  ConversationCompactionResult,
  ConversationCompactionOptions,
} from '@/core/chat/engine/compaction/index.js';

export type ChatTurnPreflightCompactionStatus = ConversationCompactionStatus;

export type PrepareChatSessionTurnArgs = {
  sessionService: ConversationSessionService;
  sessionId: string;
  fallbackHistory: ChatMessage[];
  prompt: string;
  model: string;
  stateRoot: string;
  archiveRepository?: ChatArchiveRepository;
  systemContext?: string;
  toolNames: string[];
  summarizer: ConversationCompactionOptions['summarizer'];
  leaseOwner: ChatSessionLeaseOwner;
  host: Pick<ChatTurnHostPort, 'onCompactionStatus'>;
  agentSnapshot?: CustomAgentExecutionSnapshot;
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
  'sessionService' | 'sessionId'
> & {
  leasedSession: ChatSession;
  leaseClaim: ChatSessionLeaseClaim;
  archivePath?: string;
};

export type PersistPreparedChatSessionTurnArgs = Pick<
  PrepareChatSessionTurnArgs,
  'sessionService'
> & {
  session: ChatSession;
  compacted: ConversationCompactionResult;
  leaseClaim: ChatSessionLeaseClaim;
};

export type PrepareChatSessionTurnResult =
  | {
      ok: true;
      session: ChatSession;
      compacted: ConversationCompactionResult;
      leaseClaim: ChatSessionLeaseClaim;
    }
  | {
      ok: false;
      reason: 'lease_conflict';
      message: string;
    };
