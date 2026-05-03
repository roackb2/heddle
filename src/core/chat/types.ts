import type { ChatMessage } from '../llm/types.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import type { EditFilePreview } from '../tools/edit-file.js';

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
  estimatedRequestTokens?: number;
  lastRunInputTokens?: number;
  lastRunOutputTokens?: number;
  lastRunTotalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  compactedMessages?: number;
  compactedAt?: string;
  compactionStatus?: 'idle' | 'running' | 'failed';
  compactionError?: string;
  archiveCount?: number;
  currentSummaryPath?: string;
  lastArchivePath?: string;
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

export type ChatSession = {
  id: string;
  name: string;
  workspaceId?: string;
  history: ChatMessage[];
  messages: ConversationLine[];
  turns: TurnSummary[];
  createdAt: string;
  updatedAt: string;
  model?: string;
  driftEnabled?: boolean;
  lastContinuePrompt?: string;
  context?: ChatContextStats;
  archives?: ChatArchiveRecord[];
  lease?: ChatSessionLease;
};

export type PendingApproval = {
  call: ToolCall;
  tool: ToolDefinition;
  editPreview?: EditFilePreview;
  rememberForProject?: () => void;
  rememberLabel?: string;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
};

export type ApprovalChoice = 'approve' | 'allow_project' | 'deny';
