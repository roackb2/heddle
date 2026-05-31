import type { ChatMessage, LlmUsage, ReasoningEffort } from '../llm/types.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import type { EditFilePreview } from '../tools/toolkits/coding-files/edit-file.js';
import type { ToolApprovalUserDecision } from '../approvals/types.js';

export type TurnSummary = {
  id: string;
  prompt: string;
  outcome: string;
  summary: string;
  steps: number;
  traceFile: string;
  events: string[];
};

export type ConversationLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  isPending?: boolean;
};

export type LiveEvent = {
  id: string;
  text: string;
};

export type ChatContextStats = {
  estimatedHistoryTokens: number;
  request?: {
    estimatedTokens?: number;
    toolNames?: string[];
    goal?: string;
    usage?: LlmUsage;
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

export type ChatArchiveRecord = {
  id: string;
  path: string;
  summaryPath: string;
  shortDescription?: string;
  messageCount: number;
  createdAt: string;
  summaryModel?: string;
};

export type ChatArchiveManifest = {
  version: 1;
  sessionId: string;
  currentSummaryPath?: string;
  archives: ChatArchiveRecord[];
};

export type ChatSessionLease = {
  ownerKind: 'tui' | 'daemon' | 'ask';
  ownerId: string;
  acquiredAt: string;
  lastSeenAt: string;
  clientLabel?: string;
};

export type ChatSessionRetention = 'reusable' | 'one_off';

export type QueuedConversationPrompt = {
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatSession = {
  id: string;
  name: string;
  retention?: ChatSessionRetention;
  workspaceId?: string;
  history: ChatMessage[];
  messages: ConversationLine[];
  turns: TurnSummary[];
  createdAt: string;
  updatedAt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  driftEnabled?: boolean;
  lastContinuePrompt?: string;
  context?: ChatContextStats;
  archives?: ChatArchiveRecord[];
  lease?: ChatSessionLease;
  queuedPrompts: QueuedConversationPrompt[];
};

export type PendingApproval = {
  call: ToolCall;
  tool: ToolDefinition;
  editPreview?: EditFilePreview;
  canRememberForProject?: boolean;
  rememberLabel?: string;
  resolve: (decision: ToolApprovalUserDecision) => void;
};

export type ApprovalChoice = 'approve' | 'allow_project' | 'deny';
