import { join } from 'node:path';
import type { ConversationEngineConfig } from './types.js';

export type ConversationEnginePaths = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  memoryDir: string;
  credentialStorePath?: string;
};

export function resolveConversationEnginePaths(config: ConversationEngineConfig): ConversationEnginePaths {
  return {
    workspaceRoot: config.workspaceRoot,
    stateRoot: config.stateRoot,
    sessionStoragePath: config.sessionStoragePath ?? join(config.stateRoot, 'chat-sessions.catalog.json'),
    memoryDir: config.memoryDir ?? join(config.stateRoot, 'memory'),
    credentialStorePath: config.credentialStorePath,
  };
}
