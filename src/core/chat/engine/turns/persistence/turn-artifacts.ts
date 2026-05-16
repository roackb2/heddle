import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { formatChatFailureMessage } from '@/core/chat/failure-messages.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { TraceWriter } from '../trace/index.js';
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
    const compacted = await ConversationCompactionService.compact({
      history: sourceHistory,
      runtime: compactionRuntime,
      session: args.session,
      request: compactionRequest,
      summarizer: args.summarizer,
      onStatusChange: (event) => args.onCompactionStatus?.(event, sourceHistory),
    });
    const traceFile = TraceWriter.write(args.traceDir, args.result.trace);
    const turn = ChatSessionRecords.buildTurnSummary({
      id: args.createTurnId(),
      prompt: args.prompt,
      result: args.result,
      traceFile,
      traceSummarizerRegistry: args.traceSummarizerRegistry,
    });
    const summary =
      args.result.outcome === 'error'
        ? formatChatFailureMessage(args.result.summary, {
            model: compactionRuntime.model,
            estimatedHistoryTokens: ConversationCompactionService.estimateTokens(args.historyForTokenEstimate),
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
    const session = ChatSessionRecords.applyCompletedTurn({
      session: args.session,
      prompt: args.prompt,
      compacted: artifacts.compacted,
      turn: artifacts.turn,
    });

    return {
      ...artifacts,
      session,
    };
  }
}
