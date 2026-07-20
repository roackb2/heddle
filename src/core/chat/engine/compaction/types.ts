import type { ChatArchiveRecord, ChatContextStats, ChatSession } from '@/core/chat/types.js';
import type { ConversationCompactionStatus } from '@/core/live/index.js';
import type { ChatMessage, LlmAdapter, LlmUsage } from '@/core/llm/types.js';
import type {
  ProviderCredentialSource,
  ResolvedProviderCredential,
} from '@/core/runtime/credentials/index.js';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
export type { ConversationCompactionStatus } from '@/core/live/index.js';

export type ConversationCompactionSummarizerOptions = {
  provider?: 'openai' | 'anthropic' | 'active';
  model?: string;
  apiKey?: string;
  credential?: ResolvedProviderCredential;
  credentialStorePath?: string;
  llm?: LlmAdapter;
  credentialSource?: ProviderCredentialSource;
};

export type ConversationCompactionRuntime = {
  model: string;
  stateRoot: string;
  systemContext?: string;
};

export type ConversationCompactionRequest = {
  usage?: LlmUsage;
  toolNames?: string[];
  goal?: string;
};

export type ConversationCompactionArchiveState = {
  archives: ChatArchiveRecord[];
  currentSummaryPath?: string;
  lastArchivePath?: string;
};

export type ConversationCompactionCompletedArchive = ConversationCompactionArchiveState & {
  compactedMessages: number;
  compactedAt: string;
};

export type ConversationCompactionContextInput = {
  history: ChatMessage[];
  runtime: Pick<ConversationCompactionRuntime, 'systemContext'>;
  request?: ConversationCompactionRequest;
  archive: ConversationCompactionArchiveState;
  completed?: ConversationCompactionCompletedArchive;
  status?: {
    state: NonNullable<NonNullable<ChatContextStats['compaction']>['status']>;
    error?: string;
  };
};

export type ConversationCompactionOptions = {
  history: ChatMessage[];
  runtime: ConversationCompactionRuntime;
  session: Pick<ChatSession, 'id'>;
  archiveRepository?: ChatArchiveRepository;
  request?: ConversationCompactionRequest;
  force?: boolean;
  summarizer?: ConversationCompactionSummarizerOptions;
  onStatusChange?: (event: ConversationCompactionStatus) => void | Promise<void>;
};

export type ConversationCompactionResult = {
  history: ChatMessage[];
  context: ChatContextStats;
  archive: ConversationCompactionArchiveState;
};

export type BuildSessionCompactionRunningContextOptions = {
  session: ChatSession;
  history?: ChatMessage[];
  lastArchivePath?: string;
};
