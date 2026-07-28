import type { ConversationSessionService } from '@/core/chat/engine/types.js';

export type ConversationTurnLeaseHeartbeatOptions = {
  sessionService: Pick<ConversationSessionService, 'refreshLease'>;
  sessionId: string;
  refreshIntervalMs?: number;
};
