import type { ControlPlaneServerRecord } from '@/core/runtime/daemon/index.js';
import type { HeartbeatDecision, HeartbeatRunView, HeartbeatTaskStatus, HeartbeatTaskView } from '@/core/heartbeat/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import type { MemoryStatusView } from '@/core/memory/types.js';
import type { ReviewDiffFile } from '@/core/review/index.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { ReasoningEffortOption } from '@/core/llm/models/index.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import type { AutonomyPermissionMode, AutonomyPermissionModeOption } from '@/core/approvals/index.js';
import type {
  ChatSessionRetention,
  ConversationDirectShellLineResult,
  ConversationTurnPresentation,
  QueuedConversationPrompt,
} from '@/core/chat/types.js';
import type { ConversationActivity } from '@/core/live/index.js';

export type ChatSessionView = {
  id: string;
  name: string;
  retention?: ChatSessionRetention;
  workspaceId?: string;
  pinned: boolean;
  archivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  driftEnabled?: boolean;
  driftLevel?: 'unknown' | 'low' | 'medium' | 'high';
  messageCount: number;
  turnCount: number;
  lastPrompt?: string;
  lastOutcome?: string;
  lastSummary?: string;
  context?: {
    estimatedHistoryTokens?: number;
    request?: {
      estimatedTokens?: number;
      toolNames?: string[];
      goal?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cachedInputTokens?: number;
        reasoningTokens?: number;
      };
    };
    compaction?: {
      compactedMessages?: number;
      compactedAt?: string;
      status?: 'idle' | 'running' | 'failed';
      error?: string;
    };
    archive?: {
      count?: number;
      currentSummaryPath?: string;
      lastArchivePath?: string;
    };
  };
  archives?: Array<{
    id: string;
    path: string;
    summaryPath: string;
    shortDescription?: string;
    messageCount: number;
    createdAt: string;
    summaryModel?: string;
  }>;
  queuedPromptCount: number;
};

export type ChatSessionMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  isPending?: boolean;
  directShellResult?: ConversationDirectShellLineResult;
};

export type ChatTurnAgentView = {
  id: string;
  name: string;
  modeAlias?: 'ask' | 'code' | 'review';
  source: 'project' | 'user' | 'built-in';
  definitionHash: string;
};

export type ChatTurnView = {
  id: string;
  prompt: string;
  outcome: string;
  summary: string;
  steps: number;
  traceFile: string;
  events: string[];
  presentation?: ConversationTurnPresentation;
  agent?: ChatTurnAgentView;
};

export type CommandEvidenceView = {
  tool: string;
  command: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
};

export type ApprovalEventView = {
  tool: string;
  command?: string;
  approved: boolean;
  reason?: string;
  timestamp?: string;
};

export type ChangedFileReviewView = {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  source: 'edit_file' | 'git_diff';
  patch?: string;
  diff?: ReviewDiffFile;
  truncated?: boolean;
};

export type WorkspaceChangedFileView = {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unknown';
  indexStatus?: string;
  workingTreeStatus?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
};

export type WorkspaceChangesView = {
  vcs: 'git' | 'none';
  clean: boolean;
  files: WorkspaceChangedFileView[];
  error?: string;
};

export type WorkspaceFileDiffView = {
  vcs: 'git' | 'none';
  path: string;
  patch?: string;
  diff?: ReviewDiffFile;
  binary?: boolean;
  truncated?: boolean;
  error?: string;
};

export type ChatTurnReview = {
  traceFile: string;
  diffExcerpt?: string;
  finalSummary?: string;
  files: ChangedFileReviewView[];
  reviewCommands: CommandEvidenceView[];
  verificationCommands: CommandEvidenceView[];
  mutationCommands: CommandEvidenceView[];
  approvals: ApprovalEventView[];
};

export type ChatSessionDetail = ChatSessionView & {
  messages: ChatSessionMessage[];
  turns: ChatTurnView[];
  lastContinuePrompt?: string;
  queuedPrompts: QueuedConversationPrompt[];
};

export type ControlPlaneSessionWelcomeGuide = {
  mode: 'conversation';
  hasProviderCredential: boolean;
  carriesTranscriptAcrossTurns: boolean;
};

export type ControlPlaneSessionRuntimeContext = {
  workspaceId: string;
  sessionId: string;
  sessionName: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  effectiveReasoningEffort?: ReasoningEffort;
  reasoningSupported: boolean;
  reasoningOptions: ReasoningEffortOption[];
  credentialSource: ProviderCredentialSource;
  contextWindow?: number;
  estimatedInputTokens?: number;
  driftEnabled: boolean;
  driftLevel?: ChatSessionView['driftLevel'];
  compactionStatus?: NonNullable<NonNullable<ChatSessionView['context']>['compaction']>['status'];
  running: boolean;
  permissionMode: AutonomyPermissionMode;
  permissionModeOptions: AutonomyPermissionModeOption[];
  agentOptions: Array<{
    id: string;
    name: string;
    description: string;
    modeAlias?: 'ask' | 'code' | 'review';
    source: 'project' | 'user' | 'built-in';
  }>;
  welcomeGuide: ControlPlaneSessionWelcomeGuide;
};

export type ControlPlaneAcceptedSessionRun =
  | {
    accepted: true;
    workspaceId: string;
    sessionId: string;
    runId: string;
    acceptedAt: string;
  }
  | {
    queued: true;
    workspaceId: string;
    sessionId: string;
    queueItemId: string;
    queuedAt: string;
    position: number;
  };

export type ControlPlaneSessionLiveEvent = {
  sessionId: string;
  timestamp: string;
  activities: ConversationActivity[];
};

export type ControlPlaneSessionEventEnvelope =
  | (ControlPlaneSessionLiveEvent & { type: 'session.event' })
  | {
    type: 'session.approval.updated';
    sessionId: string;
    timestamp: string;
  }
  | {
    type: 'session.queue.updated';
    sessionId: string;
    timestamp: string;
    queuedPromptCount: number;
  }
  | {
    type: 'session.updated' | 'waiting';
    sessionId: string;
    timestamp: string;
  };

export type ControlPlaneSessionsEventEnvelope = {
  type: 'sessions.updated' | 'waiting';
  timestamp: string;
};

export type ControlPlaneHeartbeatAgentEvent = {
  type: string;
  timestamp?: string;
  runId?: string;
  tool?: string;
  done?: boolean;
  decision?: HeartbeatDecision;
  outcome?: string;
  step?: number;
};

export type ControlPlaneHeartbeatEvent =
  | { type: 'heartbeat.scheduler.started'; timestamp: string }
  | { type: 'heartbeat.scheduler.stopped'; reason: 'aborted' | 'completed' | 'error'; timestamp: string }
  | { type: 'heartbeat.task.due'; taskId: string; timestamp: string }
  | {
    type: 'heartbeat.task.started';
    taskId: string;
    loadedCheckpoint: boolean;
    status: HeartbeatTaskStatus;
    progress: string;
    timestamp: string;
  }
  | {
    type: 'heartbeat.task.agent_event';
    taskId: string;
    event: ControlPlaneHeartbeatAgentEvent;
    timestamp: string;
  }
  | {
    type: 'heartbeat.task.finished';
    taskId: string;
    record: HeartbeatRunView;
    timestamp: string;
  }
  | {
    type: 'heartbeat.task.failed';
    taskId: string;
    error: string;
    status: HeartbeatTaskStatus;
    progress: string;
    nextRunAt?: string;
    timestamp: string;
  };

export type ControlPlaneHeartbeatEventEnvelope =
  | {
    type: 'heartbeat.event';
    workspaceId: string;
    timestamp: string;
    event: ControlPlaneHeartbeatEvent;
  }
  | {
    type: 'ready' | 'heartbeat';
    workspaceId: string;
    timestamp: string;
  };

export type ControlPlaneState = {
  workspaceRoot: string;
  stateRoot: string;
  auth: {
    preferApiKey: boolean;
    openai: ProviderCredentialSource;
    anthropic: ProviderCredentialSource;
  };
  activeWorkspaceId: string;
  workspace: WorkspaceDescriptor;
  workspaces: WorkspaceDescriptor[];
  knownWorkspaces: WorkspaceDescriptor[];
  runtimeHost: {
    mode: ControlPlaneServerRecord['mode'];
    serverId: string;
    registryPath: string;
    endpoint: {
      host: string;
      port: number;
    };
    startedAt: string;
  } | null;
  sessions: ChatSessionView[];
  heartbeat: {
    tasks: HeartbeatTaskView[];
    runs: HeartbeatRunView[];
  };
  memory: MemoryStatusView;
};
