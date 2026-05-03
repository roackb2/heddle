import type { RunResult } from '../../../types.js';
import type { ChatMessage } from '../../../llm/types.js';
import { compactChatHistoryWithArchive, estimateChatHistoryTokens } from '../history/compaction.js';
import { buildConversationMessages } from '../sessions/conversation-lines.js';
import { formatChatFailureMessage } from '../../failure-messages.js';
import { countAssistantSteps, summarizeTrace, type TraceSummarizerRegistry } from '../../../observability/trace-summarizers.js';
import { touchSession } from '../sessions/storage.js';
import type { ChatSession, TurnSummary } from '../../types.js';
import { saveTrace } from './trace.js';

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

export type PersistChatTurnArtifacts = {
  compacted: Awaited<ReturnType<typeof compactChatHistoryWithArchive>>;
  summary: string;
  traceFile: string;
  turn: TurnSummary;
};

export type PersistChatTurnResult = PersistChatTurnArtifacts & {
  session: ChatSession;
};

export async function createChatTurnPersistenceArtifacts(
  args: PersistChatTurnResultArgs,
): Promise<PersistChatTurnArtifacts> {
  const compacted = await compactChatHistoryWithArchive({
    history: args.result.transcript,
    model: args.model,
    sessionId: args.session.id,
    stateRoot: args.stateRoot,
    usage: args.result.usage,
    toolNames: args.toolNames,
    goal: args.prompt,
    systemContext: args.systemContext,
    summarizer: args.summarizer,
    onStatusChange: (event) => args.onCompactionStatus?.(event, args.result.transcript),
  });
  const traceFile = saveTrace(args.traceDir, args.result.trace);
  const turn: TurnSummary = {
    id: args.createTurnId(),
    prompt: args.prompt,
    outcome: args.result.outcome,
    summary: args.result.summary,
    steps: countAssistantSteps(args.result.trace),
    traceFile,
    events:
      typeof args.traceSummarizerRegistry?.summarizeTrace === 'function'
        ? args.traceSummarizerRegistry.summarizeTrace(args.result.trace)
        : summarizeTrace(args.result.trace),
  };
  const summary =
    args.result.outcome === 'error'
      ? formatChatFailureMessage(args.result.summary, {
          model: args.model,
          estimatedHistoryTokens: estimateChatHistoryTokens(args.historyForTokenEstimate),
        })
      : args.result.summary;

  return {
    compacted,
    summary,
    traceFile,
    turn,
  };
}

export async function persistChatTurnResult(args: PersistChatTurnResultArgs): Promise<PersistChatTurnResult> {
  const artifacts = await createChatTurnPersistenceArtifacts(args);
  const session = touchSession({
    ...args.session,
    lastContinuePrompt: args.prompt,
    history: artifacts.compacted.history,
    context: artifacts.compacted.context,
    archives: artifacts.compacted.archives,
    lease: undefined,
    messages: buildConversationMessages(artifacts.compacted.history),
    turns: [...args.session.turns, artifacts.turn].slice(-8),
  });

  return {
    ...artifacts,
    session,
  };
}
