import type { RunFailure } from '@/core/types.js';

export type ConversationTurnFailureHintOptions = {
  model: string;
  estimatedHistoryTokens?: number;
  failure?: RunFailure;
};
