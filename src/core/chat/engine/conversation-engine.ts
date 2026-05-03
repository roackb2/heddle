import { resolveConversationEnginePaths } from './paths.js';
import { createConversationSessionService } from './session-service.js';
import { createConversationTurnService } from './turn-service.js';
import type { ConversationEngine, ConversationEngineConfig } from './types.js';

export function createConversationEngine(config: ConversationEngineConfig): ConversationEngine {
  const normalizedConfig: ConversationEngineConfig = {
    ...config,
    memoryMaintenanceMode: config.memoryMaintenanceMode ?? 'background',
  };
  const paths = resolveConversationEnginePaths(normalizedConfig);

  return {
    sessions: createConversationSessionService({
      config: normalizedConfig,
      paths,
    }),
    turns: createConversationTurnService({
      config: normalizedConfig,
      paths,
    }),
  };
}
