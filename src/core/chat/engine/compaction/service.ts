import { ModelCatalogService } from '@/core/llm/models/index.js';
import type { ChatArchiveRecord } from '@/core/chat/types.js';
import {
  DEFAULT_CONTEXT_WINDOW_ESTIMATE,
  MAX_HISTORY_RATIO,
  MAX_RECENT_HISTORY_RATIO,
  PREFERRED_FORCED_RECENT_MESSAGES,
  PREFERRED_RECENT_MESSAGES,
} from './constants.js';
import { ConversationCompactionContextBuilder } from './context-builder.js';
import { ConversationArchiveSummarizer } from './summarizer/index.js';
import { ConversationCompactionSplitPolicy } from './split-policy.js';
import { ConversationCompactionSummaryMessage } from './summary-message.js';
import { ConversationCompactionTokenEstimator } from './token-estimator.js';
import { FileChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type {
  BuildSessionCompactionRunningContextOptions,
  ConversationCompactionArchiveState,
  ConversationCompactionOptions,
  ConversationCompactionResult,
} from './types.js';

/**
 * Main compaction service.
 *
 * Owns archive-backed conversation history compaction. Supporting classes in
 * this folder own token estimates, split policy, summary message rendering,
 * summarizer prompting, and persisted context projection.
 */
export class ConversationCompactionService {
  static async compact(
    options: ConversationCompactionOptions,
  ): Promise<ConversationCompactionResult> {
    const estimatedWindow = ModelCatalogService.estimateBuiltInContextWindow(options.runtime.model) ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
    const maxHistoryTokens = Math.floor(estimatedWindow * MAX_HISTORY_RATIO);
    const recentTokenBudget = ConversationCompactionSplitPolicy.resolveRecentHistoryTokenBudget(estimatedWindow, MAX_RECENT_HISTORY_RATIO);
    const preferredRecentMessages = options.force ? PREFERRED_FORCED_RECENT_MESSAGES : PREFERRED_RECENT_MESSAGES;
    const needsCompaction =
      ConversationCompactionTokenEstimator.estimateHistory(options.history) > maxHistoryTokens
      || (Boolean(options.force) && ConversationCompactionTokenEstimator.countNonCompactedMessages(options.history) > 0);

    if (!needsCompaction) {
      return ConversationCompactionService.buildUnchangedResult(options);
    }

    const splitIndex = ConversationCompactionSplitPolicy.findSplit(options.history, {
      recentTokenBudget,
      preferredRecentMessages,
      stopAtPreferredMessages: Boolean(options.force),
    });
    if (splitIndex <= 0 || splitIndex >= options.history.length) {
      return ConversationCompactionService.buildUnchangedResult(options);
    }

    return await ConversationCompactionService.compactArchivedSlice({ options, splitIndex });
  }

  static estimateTokens(history: ConversationCompactionOptions['history']): number {
    return ConversationCompactionTokenEstimator.estimateHistory(history);
  }

  static isCompactedHistorySummary(message: ConversationCompactionOptions['history'][number]): boolean {
    return ConversationCompactionSummaryMessage.isSummary(message);
  }

  static buildSessionRunningContext(options: BuildSessionCompactionRunningContextOptions) {
    return ConversationCompactionContextBuilder.buildSessionRunning(options);
  }

  private static buildUnchangedResult(options: ConversationCompactionOptions): ConversationCompactionResult {
    const archiveRepository = ConversationCompactionService.createArchiveRepository(options);
    const manifest = archiveRepository.loadManifest();
    const archive: ConversationCompactionArchiveState = {
      archives: manifest.archives,
      currentSummaryPath: manifest.currentSummaryPath,
    };
    return {
      history: options.history,
      context: ConversationCompactionContextBuilder.build({
        history: options.history,
        runtime: options.runtime,
        request: options.request,
        archive,
      }),
      archive,
    };
  }

  private static async compactArchivedSlice(args: {
    options: ConversationCompactionOptions;
    splitIndex: number;
  }): Promise<ConversationCompactionResult> {
    const { options, splitIndex } = args;
    const archivedMessages = options.history.slice(0, splitIndex);
    const recentMessages = options.history.slice(splitIndex);
    const archiveRepository = ConversationCompactionService.createArchiveRepository(options);
    const manifest = archiveRepository.loadManifest();
    const previousRollingSummary =
      (manifest.currentSummaryPath ? archiveRepository.readSummaryMarkdown(manifest.currentSummaryPath) : undefined)
      ?? ConversationCompactionSummaryMessage.extractPriorSummary(options.history);

    const archiveId = FileChatArchiveRepository.createArchiveId();
    const archivePath = archiveRepository.writeMessagesJsonl(archiveId, archivedMessages);
    options.onStatusChange?.({
      source: 'compaction',
      type: 'compaction.running',
      status: 'running',
      archivePath,
    });

    try {
      const summarizer = ConversationArchiveSummarizer.resolve(options);
      if (!summarizer.llm) {
        throw new Error(`Missing provider API key for ${summarizer.model}`);
      }

      const rollingSummary = await ConversationArchiveSummarizer.summarizeArchive({
        runtime: { llm: summarizer.llm, model: summarizer.model },
        summaryModel: summarizer.model,
        sessionId: options.session.id,
        archivePath,
        manifest,
        previousRollingSummary,
        archivedMessages,
      });
      const summaryPath = archiveRepository.writeSummaryMarkdown(archiveId, rollingSummary);
      const archiveRecord = ConversationCompactionService.buildArchiveRecord({
        archiveId,
        archivePath,
        summaryPath,
        rollingSummary,
        archivedMessagesCount: ConversationCompactionTokenEstimator.countNonCompactedMessages(archivedMessages),
        summaryModel: summarizer.model,
      });
      const nextManifest = FileChatArchiveRepository.appendManifestArchive(manifest, archiveRecord);
      archiveRepository.saveManifest(nextManifest);

      const compactedHistory = [
        ConversationCompactionSummaryMessage.buildArchivedSummaryMessage({
          sessionId: options.session.id,
          rollingSummary,
          archives: nextManifest.archives,
        }),
        ...recentMessages,
      ];

      options.onStatusChange?.({
        source: 'compaction',
        type: 'compaction.finished',
        status: 'finished',
        archivePath: archiveRecord.path,
        summaryPath: archiveRecord.summaryPath,
      });

      return ConversationCompactionService.buildCompactedResult({
        options,
        compactedHistory,
        archiveRecord,
        archive: {
          archives: nextManifest.archives,
          currentSummaryPath: nextManifest.currentSummaryPath,
          lastArchivePath: archiveRecord.path,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onStatusChange?.({
        source: 'compaction',
        type: 'compaction.failed',
        status: 'failed',
        archivePath,
        error: message,
      });
      return ConversationCompactionService.buildFailedResult({
        options,
        message,
        archive: {
          archives: manifest.archives,
          currentSummaryPath: manifest.currentSummaryPath,
          lastArchivePath: archivePath,
        },
      });
    }
  }

  private static buildArchiveRecord(args: {
    archiveId: string;
    archivePath: string;
    summaryPath: string;
    rollingSummary: string;
    archivedMessagesCount: number;
    summaryModel: string;
  }): ChatArchiveRecord {
    return {
      id: args.archiveId,
      path: args.archivePath,
      summaryPath: args.summaryPath,
      shortDescription: ConversationArchiveSummarizer.deriveShortDescription(args.rollingSummary),
      messageCount: args.archivedMessagesCount,
      createdAt: new Date().toISOString(),
      summaryModel: args.summaryModel,
    };
  }

  private static buildCompactedResult(args: {
    options: ConversationCompactionOptions;
    compactedHistory: ConversationCompactionResult['history'];
    archiveRecord: ChatArchiveRecord;
    archive: ConversationCompactionArchiveState;
  }): ConversationCompactionResult {
    return {
      history: args.compactedHistory,
      context: ConversationCompactionContextBuilder.build({
        history: args.compactedHistory,
        runtime: args.options.runtime,
        request: args.options.request,
        archive: args.archive,
        completed: {
          ...args.archive,
          compactedMessages: args.archiveRecord.messageCount,
          compactedAt: args.archiveRecord.createdAt,
        },
      }),
      archive: args.archive,
    };
  }

  private static buildFailedResult(args: {
    options: ConversationCompactionOptions;
    message: string;
    archive: ConversationCompactionArchiveState;
  }): ConversationCompactionResult {
    return {
      history: args.options.history,
      context: ConversationCompactionContextBuilder.build({
        history: args.options.history,
        runtime: args.options.runtime,
        request: args.options.request,
        archive: args.archive,
        status: {
          state: 'failed',
          error: args.message,
        },
      }),
      archive: args.archive,
    };
  }

  private static createArchiveRepository(options: ConversationCompactionOptions): FileChatArchiveRepository {
    return new FileChatArchiveRepository({
      stateRoot: options.runtime.stateRoot,
      sessionId: options.session.id,
    });
  }
}
