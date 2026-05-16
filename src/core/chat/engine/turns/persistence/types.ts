import type { AgentLoopResult } from '@/core/runtime/agent-loop.js';
import type { RunResult } from '@/core/types.js';
import type { ChatMessage } from '@/core/llm/types.js';
import type { ProviderCredentialSource } from '@/core/runtime/api-keys.js';
import type { TraceSummarizerRegistry } from '@/core/observability/trace-summarizers.js';
import type { ChatSession, TurnSummary } from '@/core/chat/types.js';
import type { ChatTurnHostBridge } from '../host/index.js';
import type { compactChatHistoryWithArchive } from '@/core/chat/engine/history/compaction.js';

export type PersistChatTurnCompactionStatus = {
  status: 'running' | 'finished' | 'failed';
  archivePath?: string;
  summaryPath?: string;
  error?: string;
};

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
  summarizer: Parameters<typeof compactChatHistoryWithArchive>[0]['summarizer'];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  createTurnId: () => string;
  onCompactionStatus?: (event: PersistChatTurnCompactionStatus, sourceHistory: ChatMessage[]) => void;
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
  compacted: Awaited<ReturnType<typeof compactChatHistoryWithArchive>>;
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
  traceSummarizerRegistry?: TraceSummarizerRegistry;
};

export type PersistCompletedChatTurnArgs = PersistCompletedChatTurnBase & {
  sessions: ChatSession[];
  sessionStoragePath: string;
  credentialSource: ProviderCredentialSource;
  hostBridge: Pick<ChatTurnHostBridge, 'notifyFinalCompactionStatus'>;
};

export type PersistFinalCompactionRunningSeedArgs = PersistCompletedChatTurnArgs & {
  archivePath?: string;
};

export type PersistFinalCompactionRunningContextArgs = PersistFinalCompactionRunningSeedArgs & {
  sourceHistory: PersistFinalCompactionRunningSeedArgs['result']['transcript'];
};
