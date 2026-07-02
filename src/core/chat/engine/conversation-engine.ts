import { ArtifactService } from '@/core/artifacts/index.js';
import { normalizeConversationEngineConfig } from './config.js';
import { FileConversationSessionService } from './sessions/service.js';
import { EngineConversationTurnService } from './turns/service.js';
import type { ConversationEngine, ConversationEngineConfig } from './types.js';

export function createConversationEngine(config: ConversationEngineConfig): ConversationEngine {
  const normalizedConfig = normalizeConversationEngineConfig(config);

  return {
    sessions: new FileConversationSessionService(normalizedConfig),
    turns: new EngineConversationTurnService(normalizedConfig),
    artifacts: new ArtifactService({ repository: normalizedConfig.artifactRepository }),
  };
}
