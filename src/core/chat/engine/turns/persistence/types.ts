import type { AgentLoopResult } from '@/core/runtime/loop/index.js';
import type { RunResult } from '@/core/types.js';
import type { ChatMessage } from '@/core/llm/types.js';
import type { ConversationCompactionStatus } from '@/core/live/index.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { TraceSummaryService } from '@/core/observability/index.js';
import type { ChatSession, TurnSummary } from '@/core/chat/types.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { ChatTurnHostPort } from '../host/index.js';
import type {
  ConversationCompactionResult,
  ConversationCompactionOptions,
} from '@/core/chat/engine/compaction/index.js';

export type PersistChatTurnCompactionStatus = ConversationCompactionStatus;

export type PersistChatTurnResultArgs = {
  result: RunResult;
  prompt: string;
  session: ChatSession;
  model: string;
  stateRoot: string;
  traceDir: string;
  systemContext?: string;
  toolNames: string[];
  historyForTokenEstimate: ChatMessage[];
  summarizer: ConversationCompactionOptions['summarizer'];
  traceSummarizerRegistry?: TraceSummaryService;
  createTurnId: () => string;
  onCompactionStatus?: (event: PersistChatTurnCompactionStatus, sourceHistory: ChatMessage[]) => void;
  agentSnapshot?: CustomAgentExecutionSnapshot;
};

export type PersistTurnCompactionRuntime = Pick<
  PersistChatTurnResultArgs,
  'model' | 'stateRoot' | 'systemContext'
>;

export type PersistTurnCompactionRequest = {
  usage?: RunResult['usage'];
  toolNames: string[];
  goal: string;
};

export type PersistChatTurnArtifacts = {
  compacted: ConversationCompactionResult;
  summary: string;
  traceFile: string;
  turn: TurnSummary;
};

export type PersistChatTurnResult = PersistChatTurnArtifacts & {
  session: ChatSession;
};

export type PersistCompletedChatTurnBase = {
  result: AgentLoopResult;
  prompt: string;
  session: ChatSession;
  model: string;
  stateRoot: string;
  traceDir: string;
  systemContext?: string;
  toolNames: string[];
  historyForTokenEstimate: ChatMessage[];
  traceSummarizerRegistry?: TraceSummaryService;
  agentSnapshot?: CustomAgentExecutionSnapshot;
};

export type PersistCompletedChatTurnArgs = PersistCompletedChatTurnBase & {
  sessions: ChatSession[];
  sessionRepository: ChatSessionRepository;
  credentialSource: ProviderCredentialSource;
  host: Pick<ChatTurnHostPort, 'onCompactionStatus'>;
};

export type PersistFinalCompactionRunningSeedArgs = PersistCompletedChatTurnArgs & {
  archivePath?: string;
};

export type PersistFinalCompactionRunningContextArgs = PersistFinalCompactionRunningSeedArgs & {
  sourceHistory: PersistFinalCompactionRunningSeedArgs['result']['transcript'];
};
