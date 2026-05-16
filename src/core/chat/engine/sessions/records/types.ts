import type { ReasoningEffort } from '@/core/llm/types.js';
import type { TraceSummarizerRegistry } from '@/core/observability/trace-summarizers.js';
import type { ConversationCompactionResult } from '@/core/chat/engine/compaction/index.js';
import type { RunResult } from '@/core/types.js';
import type { ChatSession, ChatSessionRetention, TurnSummary } from '@/core/chat/types.js';

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
  normalize: (value: string | undefined) => string | undefined;
};

export type BuildChatTurnSummaryInput = {
  id: string;
  prompt: string;
  result: RunResult;
  traceFile: string;
  traceSummarizerRegistry?: TraceSummarizerRegistry;
};

export type ApplyCompactedChatSessionHistoryInput = {
  session: ChatSession;
  compacted: ConversationCompactionResult;
};

export type ApplyCompletedChatSessionTurnInput = ApplyCompactedChatSessionHistoryInput & {
  prompt: string;
  turn: TurnSummary;
};
