import type { ReasoningEffort } from '@/core/llm/types.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { ConversationCompactionResult } from '@/core/chat/engine/compaction/index.js';
import type { RunResult } from '@/core/types.js';
import type { ChatSession, ChatSessionRetention, ConversationLine, TurnSummary } from '@/core/chat/types.js';

export type CreateChatSessionRecordOptions = {
  id: string;
  name: string;
  apiKeyPresent: boolean;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  workspaceId?: string;
  retention?: ChatSessionRetention;
};

export type GenerateChatSessionTitleInput = {
  prompt: string;
  responseText: string;
};

export type BuildChatTurnSummaryInput = {
  id: string;
  prompt: string;
  result: RunResult;
  traceFile: string;
  traceSummarizerRegistry?: TraceSummaryService;
};

export type ApplyCompactedChatSessionHistoryInput = {
  session: ChatSession;
  compacted: ConversationCompactionResult;
  preserveAcceptedUserMessages?: boolean;
};

export type ApplyCompletedChatSessionTurnInput = ApplyCompactedChatSessionHistoryInput & {
  prompt: string;
  turn: TurnSummary;
};

export type MarkAcceptedConversationUserMessageInput = {
  runId: string;
  prompt: string;
};

export type MarkAcceptedConversationUserMessageFailedInput = {
  runId: string;
  failureMessage: ConversationLine;
};
