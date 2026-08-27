import type { Logger } from 'pino';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type {
  LlmAdapter,
  LlmProvider,
  LlmUsage,
  ReasoningEffort,
} from '@/core/llm/types.js';
import type { RuntimeProviderCredential } from '@/core/runtime/credentials/index.js';
import type {
  ConversationDelegationActivity,
  ConversationDelegationErrorCode,
} from '@/core/live/index.js';
import type {
  RunFailure,
  StopReason,
  ToolExecutionContext,
  TraceEvent,
} from '@/core/types.js';

export type DelegationAgentProfileId = 'builtin:ask' | 'builtin:review';

export type DelegationPolicy = {
  readonly enabled: boolean;
  readonly maxDepth: 1;
  readonly maxChildren: number;
  readonly maxConcurrentChildren: number;
  readonly maxStepsPerChild: number;
  readonly maxChildDurationMs: number;
  readonly allowedAgentProfileIds: readonly DelegationAgentProfileId[];
};

export type DelegationPolicyInput = {
  enabled?: boolean;
  maxDepth?: number;
  maxChildren?: number;
  maxConcurrentChildren?: number;
  maxStepsPerChild?: number;
  maxChildDurationMs?: number;
  allowedAgentProfileIds?: readonly string[];
};

export type DelegationServiceOptions = {
  policy?: DelegationPolicyInput;
};

export type DelegateTaskInput = {
  task: string;
  agentProfileId?: DelegationAgentProfileId;
};

export type DelegateTaskExecutionContext = ToolExecutionContext & {
  /**
   * Host-owned depth of the caller. The model-facing tool always supplies 0;
   * this seam lets direct programmatic callers receive the same depth guard.
   */
  parentDepth?: number;
};

export type DelegationRejectionCode = ConversationDelegationErrorCode;

export type DelegateTaskError = {
  code: DelegationRejectionCode;
  message: string;
};

export type DelegateTaskOutput = {
  schemaVersion: 1;
  status: 'finished' | 'cancelled' | 'rejected';
  delegationId?: string;
  childRunId?: string;
  agentProfileId?: DelegationAgentProfileId;
  outcome?: StopReason;
  summary?: string;
  failure?: RunFailure;
  error?: DelegateTaskError;
};

export type DelegatedRunStatus = 'running' | 'finished' | 'cancelled';

/**
 * Host-facing in-memory record. Child transcripts are deliberately omitted;
 * model-facing tool output is a smaller projection of this record.
 */
export type DelegatedRunRecord = {
  schemaVersion: 1;
  delegationId: string;
  rootRunId: string;
  parentRunId: string;
  childRunId: string;
  depth: 1;
  task: string;
  agentSnapshot: CustomAgentExecutionSnapshot;
  status: DelegatedRunStatus;
  outcome?: StopReason;
  summary?: string;
  failure?: RunFailure;
  model?: string;
  provider?: LlmProvider;
  usage?: LlmUsage;
  startedAt: string;
  finishedAt?: string;
  trace: TraceEvent[];
};

export type DelegationRootScopeSnapshot = {
  schemaVersion: 1;
  rootRunId: string;
  policy: DelegationPolicy;
  records: DelegatedRunRecord[];
};

export type DelegationChildLlmFactoryInput = {
  rootRunId: string;
  parentRunId: string;
  childRunId: string;
  delegationId: string;
  depth: 1;
  task: string;
  agentSnapshot: CustomAgentExecutionSnapshot;
  model: string;
  reasoningEffort?: ReasoningEffort;
  signal: AbortSignal;
};

export type DelegationChildLlmFactory = (
  input: DelegationChildLlmFactoryInput,
) => LlmAdapter | Promise<LlmAdapter>;

/**
 * Root runtime facts inherited by every child. Snapshot model/reasoning
 * defaults do not override these values in read-only delegation v1.
 */
export type DelegationChildRuntimeOptions = {
  model: string;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
  credential?: RuntimeProviderCredential;
  preferApiKey?: boolean;
  maxToolConcurrency?: number;
  stateDir?: string;
  memoryDir?: string;
  searchIgnoreDirs?: string[];
  baseSystemContext?: string;
  logger?: Logger;
  createChildLlm?: DelegationChildLlmFactory;
};

export type DelegationAgentSnapshotResolver = {
  resolveExecutionSnapshot(agentProfileId: string): CustomAgentExecutionSnapshot | undefined;
};

export type CreateDelegationRootScopeOptions = {
  rootRunId?: string;
  workspaceRoot: string;
  runtime: DelegationChildRuntimeOptions;
  homeDir?: string;
  agentSnapshotResolver?: DelegationAgentSnapshotResolver;
  onActivity?: (activity: ConversationDelegationActivity) => void;
};
