import type { ConversationActivity } from '@/core/chat/engine/live/index.js';

export type ControlPlaneSessionEventEnvelope = {
  type: string;
  sessionId: string;
  timestamp?: string;
  activities?: ConversationActivity[];
};
