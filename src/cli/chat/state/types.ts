import type { ChatMessage, ToolCall, ToolDefinition } from '../../../index.js';
import type { EditFilePreview } from '../../../tools/edit-file.js';

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
};

export type LiveEvent = {
  id: string;
  text: string;
};

export type ChatSession = {
  id: string;
  name: string;
  history: ChatMessage[];
  messages: ConversationLine[];
  turns: TurnSummary[];
  createdAt: string;
  updatedAt: string;
  lastContinuePrompt?: string;
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

export type LocalCommandResult =
  | { handled: false }
  | { handled: true; kind: 'message'; message: string }
  | { handled: true; kind: 'continue'; sessionId?: string; message?: string };
