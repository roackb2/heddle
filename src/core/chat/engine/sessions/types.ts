import type { ConversationEngineConfig, ConversationSessionService } from '../types.js';
import type { NormalizedConversationEngineConfig } from '../config.js';

export type ConversationSessionServiceConfig = Pick<
  ConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'workspaceId' | 'apiKeyPresent'
>;

export type NormalizedConversationSessionServiceConfig = Pick<
  NormalizedConversationEngineConfig,
  'workspaceRoot' | 'stateRoot' | 'model' | 'reasoningEffort' | 'sessionStoragePath' | 'workspaceId' | 'apiKeyPresent'
>;

export type FileConversationSessionServiceContract = ConversationSessionService;
