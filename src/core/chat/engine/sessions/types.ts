import type { ConversationEngineConfig, ConversationSessionService } from '../types.js';
import type { NormalizedConversationEngineConfig } from '../config.js';

export type ConversationSessionServiceConfig = Omit<Pick<
  ConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'sessionRepository' | 'workspaceId'
>, 'model'> & {
  /** Optional when wrapping an existing repository for a turn-only runtime. */
  model?: ConversationEngineConfig['model'];
};

export type NormalizedConversationSessionServiceConfig = Omit<Pick<
  NormalizedConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'sessionRepository' | 'workspaceId'
>, 'model'> & {
  model?: NormalizedConversationEngineConfig['model'];
};

export type FileConversationSessionServiceContract = ConversationSessionService;
