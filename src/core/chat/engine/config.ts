import { join, resolve } from 'node:path';
import type { ToolApprovalPolicy } from '../../approvals/types.js';
import type { TraceSummarizerRegistry } from '../../observability/trace-summarizers.js';
import type { ConversationEngineConfig } from './types.js';

export type NormalizedConversationEngineConfig = {
  workspaceRoot: string;
  stateRoot: string;
  model: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  memoryMaintenanceMode: 'none' | 'background' | 'inline';
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  approvalPolicies?: ToolApprovalPolicy[];
  sessionStoragePath: string;
  memoryDir: string;
  traceDir: string;
  workspaceId?: string;
  apiKeyPresent: boolean;
};

export function normalizeConversationEngineConfig(config: ConversationEngineConfig): NormalizedConversationEngineConfig {
  const workspaceRoot = resolve(config.workspaceRoot);
  const stateRoot = resolve(config.stateRoot);
  const sessionStoragePath = resolve(config.sessionStoragePath ?? join(stateRoot, 'chat-sessions.catalog.json'));
  const memoryDir = resolve(config.memoryDir ?? join(stateRoot, 'memory'));
  const traceDir = resolve(join(stateRoot, 'traces'));
  const credentialStorePath = config.credentialStorePath ? resolve(config.credentialStorePath) : undefined;

  return {
    workspaceRoot,
    stateRoot,
    model: config.model,
    apiKey: config.apiKey,
    preferApiKey: config.preferApiKey,
    credentialStorePath,
    systemContext: config.systemContext,
    memoryMaintenanceMode: config.memoryMaintenanceMode ?? 'background',
    traceSummarizerRegistry: config.traceSummarizerRegistry,
    approvalPolicies: config.approvalPolicies,
    sessionStoragePath,
    memoryDir,
    traceDir,
    workspaceId: config.workspaceId,
    apiKeyPresent: config.apiKeyPresent ?? Boolean(config.apiKey),
  };
}
