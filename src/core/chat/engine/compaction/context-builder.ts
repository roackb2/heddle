import type { ChatContextStats } from '@/core/chat/types.js';
import { ConversationCompactionTokenEstimator } from './token-estimator.js';
import type {
  BuildSessionCompactionRunningContextOptions,
  ConversationCompactionContextInput,
} from './types.js';

/**
 * Projects compaction-owned runtime state into persisted session context stats.
 */
export class ConversationCompactionContextBuilder {
  static buildSessionRunning(options: BuildSessionCompactionRunningContextOptions): ChatContextStats {
    const previous = options.session.context;
    return {
      ...previous,
      estimatedHistoryTokens: ConversationCompactionTokenEstimator.estimateHistory(options.history ?? options.session.history),
      request: previous?.request,
      compaction: {
        ...previous?.compaction,
        status: 'running',
        error: undefined,
      },
      archive: {
        count: options.session.archives?.length ?? previous?.archive?.count,
        currentSummaryPath: previous?.archive?.currentSummaryPath,
        lastArchivePath: options.lastArchivePath ?? previous?.archive?.lastArchivePath,
      },
    };
  }

  static build(input: ConversationCompactionContextInput): ChatContextStats {
    return {
      estimatedHistoryTokens: ConversationCompactionTokenEstimator.estimateHistory(input.history),
      request: {
        ...input.request,
        estimatedTokens: ConversationCompactionTokenEstimator.estimateRequest(input),
      },
      compaction: {
        compactedMessages:
          input.completed?.compactedMessages && input.completed.compactedMessages > 0
            ? input.completed.compactedMessages
            : undefined,
        compactedAt: input.completed?.compactedAt,
        status: input.status?.state ?? 'idle',
        error: input.status?.error,
      },
      archive: {
        count: input.archive.archives.length || undefined,
        currentSummaryPath: input.archive.currentSummaryPath,
        lastArchivePath: input.completed?.lastArchivePath ?? input.archive.lastArchivePath,
      },
    };
  }
}
