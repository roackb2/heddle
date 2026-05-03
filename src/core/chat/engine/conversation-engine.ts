import { normalizeConversationEngineConfig } from './config.js';
import { createConversationSessionService } from './sessions/service.js';
import { createConversationTurnService } from './turns/service.js';
import type { ConversationEngine, ConversationEngineConfig } from './types.js';

export function createConversationEngine(config: ConversationEngineConfig): ConversationEngine {
  const normalizedConfig = normalizeConversationEngineConfig(config);

  return {
    sessions: createConversationSessionService({
      config: normalizedConfig,
    }),
    turns: createConversationTurnService({
      config: normalizedConfig,
    }),
  };
}
