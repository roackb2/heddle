import { join, resolve } from 'node:path';
import { FileArtifactRepository } from '@/core/artifacts/index.js';
import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { ChatSessionRepository } from './sessions/repository/index.js';
import type { ChatArchiveRepository } from './sessions/archives/index.js';
import type { ToolApprovalPolicy } from '../../approvals/types.js';
import type { ReasoningEffort } from '../../llm/types.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { ConversationEngineConfig } from './types.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';
import { ConversationEngineHostExtensionService } from './host-extension.js';
import type { RuntimeToolSelectionProfile } from '@/core/runtime/tools/index.js';
import {
  ConversationPersistenceService,
} from './persistence/conversation-persistence.js';
import type {
  ResolvedHeddlePersistenceCapabilities,
} from './persistence/index.js';

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
  toolProfile?: RuntimeToolSelectionProfile;
  traceSummarizerRegistry?: TraceSummaryService;
  approvalPolicies?: ToolApprovalPolicy[];
  tools?: ToolDefinition[];
  toolkits?: ToolToolkit[];
  hiddenMcpServerIds?: string[];
  artifactRoot: string;
  artifactRepository: ArtifactRepository;
  artifactsEnabled: boolean;
  sessionStoragePath: string;
  sessionRepository: ChatSessionRepository;
  archiveRepository: ChatArchiveRepository;
  persistence: ResolvedHeddlePersistenceCapabilities;
  memoryDir: string;
  traceDir: string;
  workspaceId?: string;
  apiKeyPresent: boolean;
};

export function normalizeConversationEngineConfig(config: ConversationEngineConfig): NormalizedConversationEngineConfig {
  const workspaceRoot = resolve(config.workspaceRoot);
  const stateRoot = resolve(config.stateRoot);
  const sessionStoragePath = resolve(config.sessionStoragePath ?? join(stateRoot, 'chat-sessions.catalog.json'));
  // Resolve conversation persistence once at the engine boundary. New hosts
  // configure the coherent capability; older separate options remain a
  // compatibility path and receive an explicit readiness disposition.
  const persistence = ConversationPersistenceService.resolve({
    persistence: config.persistence,
    sessionRepository: config.sessionRepository,
    archiveRepository: config.archiveRepository,
    sessionStoragePath,
    stateRoot,
  });
  const memoryDir = resolve(config.memoryDir ?? join(stateRoot, 'memory'));
  const traceDir = resolve(join(stateRoot, 'traces'));
  const hostExtensions = ConversationEngineHostExtensionService.compose(config.hostExtensions);
  const artifactRoot = resolve(hostExtensions?.artifacts?.root ?? join(stateRoot, 'artifacts'));
  // Resolve artifact persistence once at the engine boundary; everything
  // downstream (reader, turn results, artifact tools) receives this instance.
  const artifactRepository = config.artifactRepository ?? new FileArtifactRepository({ artifactRoot });
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
    toolProfile: config.toolProfile,
    traceSummarizerRegistry: config.traceSummarizerRegistry,
    approvalPolicies: config.approvalPolicies,
    tools: tools.length ? tools : undefined,
    toolkits: hostExtensions?.toolkits,
    hiddenMcpServerIds: hostExtensions?.mcp?.hideDefaultServers,
    artifactRoot,
    artifactRepository,
    artifactsEnabled: hostExtensions?.artifacts?.enabled ?? true,
    sessionStoragePath,
    sessionRepository: persistence.conversations.sessions,
    archiveRepository: persistence.conversations.archives,
    persistence,
    memoryDir,
    traceDir,
    workspaceId: config.workspaceId,
    apiKeyPresent: config.apiKeyPresent ?? Boolean(config.apiKey),
  };
}
