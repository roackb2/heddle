import { join, resolve } from 'node:path';
import type { ToolApprovalPolicy } from '../../approvals/types.js';
import type { ReasoningEffort } from '../../llm/types.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { ConversationEngineConfig } from './types.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';
import { ConversationEngineHostExtensionService } from './host-extension.js';

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
  toolkits?: ToolToolkit[];
  hiddenMcpServerIds?: string[];
  artifactRoot: string;
  artifactsEnabled: boolean;
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
  const hostExtensions = ConversationEngineHostExtensionService.compose(config.hostExtensions);
  const artifactRoot = resolve(hostExtensions?.artifacts?.root ?? join(stateRoot, 'artifacts'));
  const credentialStorePath = config.credentialStorePath ? resolve(config.credentialStorePath) : undefined;
  const tools = [
    ...(config.tools ?? []),
    ...(hostExtensions?.tools ?? []),
  ];
  const systemContext = [
    config.systemContext,
    hostExtensions?.systemContext,
  ].filter((value): value is string => Boolean(value)).join('\n\n') || undefined;

  return {
    workspaceRoot,
    stateRoot,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    apiKey: config.apiKey,
    preferApiKey: config.preferApiKey,
    credentialStorePath,
    systemContext,
    memoryMaintenanceMode: config.memoryMaintenanceMode ?? 'background',
    traceSummarizerRegistry: config.traceSummarizerRegistry,
    approvalPolicies: config.approvalPolicies,
    tools: tools.length ? tools : undefined,
    toolkits: hostExtensions?.toolkits,
    hiddenMcpServerIds: hostExtensions?.mcp?.hideDefaultServers,
    artifactRoot,
    artifactsEnabled: hostExtensions?.artifacts?.enabled ?? true,
    sessionStoragePath,
    memoryDir,
    traceDir,
    workspaceId: config.workspaceId,
    apiKeyPresent: config.apiKeyPresent ?? Boolean(config.apiKey),
  };
}
