import type { AgentModelContextRecovery } from '@/core/agent/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatSessionLeaseClaim } from '@/core/chat/engine/sessions/leases/index.js';
import type { ConversationCompactionOptions } from '@/core/chat/engine/compaction/index.js';
import type { ChatTurnHostPort } from '../host/index.js';

export type RecoverConversationTurnContextArgs = Parameters<AgentModelContextRecovery>[0] & {
  sessionService: ConversationSessionService;
  sessionId: string;
  leaseClaim: ChatSessionLeaseClaim;
  model: string;
  stateRoot: string;
  archiveRepository?: ChatArchiveRepository;
  systemContext?: string;
  toolNames: string[];
  prompt: string;
  summarizer: ConversationCompactionOptions['summarizer'];
  host: Pick<ChatTurnHostPort, 'onCompactionStatus'>;
};

export type RecoverConversationTurnContextResult = Awaited<ReturnType<AgentModelContextRecovery>>;
