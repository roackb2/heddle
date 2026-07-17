import type { ChatArchiveManifest } from '@/core/chat/types.js';
import type { ChatMessage, LlmAdapter } from '@/core/llm/types.js';

export type ConversationArchiveSummarizerRuntime = {
  llm: LlmAdapter;
  model: string;
};

export type ConversationArchiveSummaryContext = {
  sessionId: string;
  archiveId: string;
  manifest: ChatArchiveManifest;
  previousRollingSummary?: string;
  archivedMessages: ChatMessage[];
  summaryModel: string;
};

export type ResolvedConversationArchiveSummarizer = {
  llm?: LlmAdapter;
  model: string;
};
