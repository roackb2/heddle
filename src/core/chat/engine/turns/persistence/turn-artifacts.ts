import { compactChatHistoryWithArchive, estimateChatHistoryTokens } from '@/core/chat/engine/history/compaction.js';
import { formatChatFailureMessage } from '@/core/chat/failure-messages.js';
import { countAssistantSteps, summarizeTrace } from '@/core/observability/trace-summarizers.js';
import { ChatSessionRecords, ConversationLines } from '@/core/chat/engine/sessions/records/index.js';
import { TraceWriter } from '../trace/index.js';
import type { ChatSession, TurnSummary } from '@/core/chat/types.js';
import type {
  PersistChatTurnArtifacts,
  PersistChatTurnResult,
  PersistChatTurnResultArgs,
  PersistTurnCompactionRequest,
  PersistTurnCompactionRuntime,
} from './types.js';

/**
 * Builds persisted artifacts for a completed turn without owning storage.
 */
export class ConversationTurnArtifacts {
  static async build(args: PersistChatTurnResultArgs): Promise<PersistChatTurnArtifacts> {
    const compactionRuntime: PersistTurnCompactionRuntime = args;
    const sourceHistory = args.result.transcript;
    const compactionRequest: PersistTurnCompactionRequest = {
      usage: args.result.usage,
      toolNames: args.toolNames,
      goal: args.prompt,
    };
    const compacted = await compactChatHistoryWithArchive({
      history: sourceHistory,
      runtime: compactionRuntime,
      session: args.session,
      request: compactionRequest,
      summarizer: args.summarizer,
      onStatusChange: (event) => args.onCompactionStatus?.(event, sourceHistory),
    });
    const traceFile = TraceWriter.write(args.traceDir, args.result.trace);
    const turn = ConversationTurnArtifacts.buildTurnSummary({ turn: args, traceFile });
    const summary =
      args.result.outcome === 'error'
        ? formatChatFailureMessage(args.result.summary, {
            model: compactionRuntime.model,
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

  static async persist(args: PersistChatTurnResultArgs): Promise<PersistChatTurnResult> {
    const artifacts = await ConversationTurnArtifacts.build(args);
    const session = ConversationTurnArtifacts.buildPersistedSession({ turn: args, artifacts });

    return {
      ...artifacts,
      session,
    };
  }

  private static buildTurnSummary(args: {
    turn: PersistChatTurnResultArgs;
    traceFile: string;
  }): TurnSummary {
    return {
      id: args.turn.createTurnId(),
      prompt: args.turn.prompt,
      outcome: args.turn.result.outcome,
      summary: args.turn.result.summary,
      steps: countAssistantSteps(args.turn.result.trace),
      traceFile: args.traceFile,
      events:
        typeof args.turn.traceSummarizerRegistry?.summarizeTrace === 'function'
          ? args.turn.traceSummarizerRegistry.summarizeTrace(args.turn.result.trace)
          : summarizeTrace(args.turn.result.trace),
    };
  }

  private static buildPersistedSession(args: {
    turn: PersistChatTurnResultArgs;
    artifacts: PersistChatTurnArtifacts;
  }): ChatSession {
    return ChatSessionRecords.touch({
      ...args.turn.session,
      lastContinuePrompt: args.turn.prompt,
      history: args.artifacts.compacted.history,
      context: args.artifacts.compacted.context,
      archives: args.artifacts.compacted.archives,
      lease: undefined,
      messages: ConversationLines.fromHistory(args.artifacts.compacted.history),
      turns: [...args.turn.session.turns, args.artifacts.turn].slice(-8),
    });
  }
}
