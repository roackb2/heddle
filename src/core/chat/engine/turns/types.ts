import type { ArtifactRepository } from '@/core/artifacts/index.js';
import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ConversationCompactionStatus } from '@/core/live/index.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { RunAgentLoopOptions } from '@/core/runtime/loop/index.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatTurnHostPort } from './host/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { RuntimeToolSelectionProfile } from '@/core/runtime/tools/index.js';

export type RunConversationTurnArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  /** Custom session persistence. Defaults to the file catalog at `sessionStoragePath`. */
  sessionRepository?: ChatSessionRepository;
  archiveRepository?: ChatArchiveRepository;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  traceDir: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  toolProfile?: RuntimeToolSelectionProfile;
  host?: ChatTurnHostPort;
  approvalPolicies?: ToolApprovalPolicy[];
  tools?: ToolDefinition[];
  toolkits?: ToolToolkit[];
  hiddenMcpServerIds?: string[];
  artifactRoot: string;
  artifactRepository?: ArtifactRepository;
  artifactsEnabled: boolean;
  agentProfileId?: string;
  agentSnapshot?: CustomAgentExecutionSnapshot;
  traceSummarizerRegistry?: TraceSummaryService;
  onCompactionStatus?: (event: ConversationCompactionStatus) => void;
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
  shouldStop?: RunAgentLoopOptions['shouldStop'];
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export type TurnRuntimeConfigInput = Pick<
  RunConversationTurnArgs,
  | 'workspaceRoot'
  | 'stateRoot'
  | 'sessionStoragePath'
  | 'sessionRepository'
  | 'archiveRepository'
  | 'apiKey'
  | 'preferApiKey'
  | 'credentialStorePath'
  | 'systemContext'
  | 'traceDir'
  | 'memoryMaintenanceMode'
  | 'toolProfile'
  | 'approvalPolicies'
  | 'tools'
  | 'toolkits'
  | 'hiddenMcpServerIds'
  | 'artifactRoot'
  | 'artifactRepository'
  | 'artifactsEnabled'
  | 'traceSummarizerRegistry'
>;

export type TurnSubmitInput = Pick<
  RunConversationTurnArgs,
  | 'sessionId'
  | 'prompt'
  | 'maxSteps'
  | 'searchIgnoreDirs'
  | 'includePlanTool'
  | 'abortSignal'
  | 'leaseOwner'
  | 'agentProfileId'
  | 'agentSnapshot'
>;

export type TurnHostInput = Pick<
  RunConversationTurnArgs,
  'host' | 'onTraceEvent' | 'shouldStop'
>;

export type TurnPreflightInput = Pick<
  RunConversationTurnArgs,
  'stateRoot' | 'archiveRepository' | 'prompt'
>;

export type AgentLoopTurnInput = Pick<
  RunConversationTurnArgs,
  'prompt' | 'maxSteps' | 'workspaceRoot' | 'stateRoot' | 'onTraceEvent' | 'approvalPolicies' | 'shouldStop' | 'abortSignal'
>;

export type TurnPersistenceInput = Pick<
  RunConversationTurnArgs,
  'stateRoot' | 'archiveRepository' | 'traceDir' | 'traceSummarizerRegistry' | 'prompt'
>;

export type RunConversationTurnResult = ConversationTurnResultSummary;
