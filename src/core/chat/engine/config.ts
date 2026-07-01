import { join, resolve } from 'node:path';
import type { ToolApprovalPolicy } from '../../approvals/types.js';
import type { ReasoningEffort } from '../../llm/types.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { ConversationEngineConfig } from './types.js';
import type { ToolDefinition } from '@/core/types.js';

export type NormalizedConversationEngineConfig = {
  workspaceRoot: string;
  stateRoot: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  memoryMaintenanceMode: 'none' | 'background' | 'inline';
  traceSummarizerRegistry?: TraceSummaryService;
  approvalPolicies?: ToolApprovalPolicy[];
  tools?: ToolDefinition[];
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
    reasoningEffort: config.reasoningEffort,
    apiKey: config.apiKey,
    preferApiKey: config.preferApiKey,
    credentialStorePath,
    systemContext: config.systemContext,
    memoryMaintenanceMode: config.memoryMaintenanceMode ?? 'background',
    traceSummarizerRegistry: config.traceSummarizerRegistry,
    approvalPolicies: config.approvalPolicies,
    tools: config.tools,
    sessionStoragePath,
    memoryDir,
    traceDir,
    workspaceId: config.workspaceId,
    apiKeyPresent: config.apiKeyPresent ?? Boolean(config.apiKey),
  };
}
