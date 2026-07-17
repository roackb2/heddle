import { randomUUID } from 'node:crypto';
import { ModelCatalogService } from '@/core/llm/models/index.js';
import type { ChatArchiveManifest } from '@/core/chat/types.js';
import {
  ChatArchiveSummaryNotFoundError,
  ChatArchiveRepositoryError,
  FileChatArchiveRepository,
  type ChatArchiveRecordDraft,
  type ChatArchiveRepository,
} from '@/core/chat/engine/sessions/archives/index.js';
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
      return await ConversationCompactionService.buildUnchangedResult(options);
    }

    const splitIndex = ConversationCompactionSplitPolicy.findSplit(options.history, {
      recentTokenBudget,
      preferredRecentMessages,
      stopAtPreferredMessages: Boolean(options.force),
    });
    if (splitIndex <= 0 || splitIndex >= options.history.length) {
      return await ConversationCompactionService.buildUnchangedResult(options);
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

  private static async buildUnchangedResult(
    options: ConversationCompactionOptions,
  ): Promise<ConversationCompactionResult> {
    let manifest: ChatArchiveManifest;
    try {
      manifest = await ConversationCompactionService.createArchiveRepository(options)
        .loadManifest(options.session.id);
    } catch (error) {
      throw ConversationCompactionService.repositoryError('load_manifest', error);
    }
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
    let manifest: ChatArchiveManifest;
    let previousRollingSummary: string | undefined;

    try {
      manifest = await archiveRepository.loadManifest(options.session.id);
    } catch (error) {
      const repositoryError = ConversationCompactionService.repositoryError('load_manifest', error);
      await ConversationCompactionService.emitFailure(options, repositoryError);
      throw repositoryError;
    }

    try {
      previousRollingSummary = await ConversationCompactionService.readPreviousRollingSummary({
        archiveRepository,
        manifest,
        history: options.history,
      });
    } catch (error) {
      const repositoryError = ConversationCompactionService.repositoryError('read_summary', error);
      await ConversationCompactionService.emitFailure(options, repositoryError);
      throw repositoryError;
    }

    const archiveId = ConversationCompactionService.createArchiveId();
    await options.onStatusChange?.({
      source: 'compaction',
      type: 'compaction.running',
      status: 'running',
    });

    let rollingSummary: string;
    let summaryModel: string;
    try {
      const summarizer = ConversationArchiveSummarizer.resolve(options);
      if (!summarizer.llm) {
        throw new Error(`Missing provider API key for ${summarizer.model}`);
      }
      summaryModel = summarizer.model;
      rollingSummary = await ConversationArchiveSummarizer.summarizeArchive({
        runtime: { llm: summarizer.llm, model: summarizer.model },
        summaryModel: summarizer.model,
        sessionId: options.session.id,
        archiveId,
        manifest,
        previousRollingSummary,
        archivedMessages,
      });
    } catch (error) {
      const message = await ConversationCompactionService.emitFailure(options, error);
      return ConversationCompactionService.buildFailedResult({
        options,
        message,
        archive: ConversationCompactionService.archiveStateFromManifest(manifest),
      });
    }

    const archiveDraft = ConversationCompactionService.buildArchiveRecordDraft({
      archiveId,
      rollingSummary,
      archivedMessagesCount: ConversationCompactionTokenEstimator.countNonCompactedMessages(archivedMessages),
      summaryModel,
    });
    let appended: Awaited<ReturnType<ChatArchiveRepository['append']>>;
    try {
      appended = await archiveRepository.append({
        sessionId: options.session.id,
        archive: archiveDraft,
        messages: archivedMessages,
        summary: rollingSummary,
      });
    } catch (error) {
      const repositoryError = ConversationCompactionService.repositoryError('append', error);
      await ConversationCompactionService.emitFailure(options, repositoryError);
      throw repositoryError;
    }

    const compactedHistory = [
      ConversationCompactionSummaryMessage.buildArchivedSummaryMessage({
        rollingSummary,
        archives: appended.manifest.archives,
      }),
      ...recentMessages,
    ];

    await options.onStatusChange?.({
      source: 'compaction',
      type: 'compaction.finished',
      status: 'finished',
      archivePath: appended.archive.path,
      summaryPath: appended.archive.summaryPath,
    });

    return ConversationCompactionService.buildCompactedResult({
      options,
      compactedHistory,
      archiveRecord: appended.archive,
      archive: {
        archives: appended.manifest.archives,
        currentSummaryPath: appended.manifest.currentSummaryPath,
        lastArchivePath: appended.archive.path,
      },
    });
  }

  private static async readPreviousRollingSummary(args: {
    archiveRepository: ChatArchiveRepository;
    manifest: ChatArchiveManifest;
    history: ConversationCompactionOptions['history'];
  }): Promise<string | undefined> {
    if (!args.manifest.currentSummaryPath) {
      return ConversationCompactionSummaryMessage.extractPriorSummary(args.history);
    }

    const summary = await args.archiveRepository.readSummary(args.manifest.currentSummaryPath);
    if (summary === undefined) {
      throw new ChatArchiveSummaryNotFoundError(args.manifest.currentSummaryPath);
    }
    return summary;
  }

  private static createArchiveId(now = new Date()): string {
    return `archive-${now.toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  }

  private static buildArchiveRecordDraft(args: {
    archiveId: string;
    rollingSummary: string;
    archivedMessagesCount: number;
    summaryModel: string;
  }): ChatArchiveRecordDraft {
    return {
      id: args.archiveId,
      shortDescription: ConversationArchiveSummarizer.deriveShortDescription(args.rollingSummary),
      messageCount: args.archivedMessagesCount,
      createdAt: new Date().toISOString(),
      summaryModel: args.summaryModel,
    };
  }

  private static archiveStateFromManifest(manifest: ChatArchiveManifest): ConversationCompactionArchiveState {
    return {
      archives: manifest.archives,
      currentSummaryPath: manifest.currentSummaryPath,
      lastArchivePath: manifest.archives.at(-1)?.path,
    };
  }

  private static async emitFailure(
    options: ConversationCompactionOptions,
    error: unknown,
  ): Promise<string> {
    const message = error instanceof Error ? error.message : String(error);
    await options.onStatusChange?.({
      source: 'compaction',
      type: 'compaction.failed',
      status: 'failed',
      error: message,
    });
    return message;
  }

  private static repositoryError(
    operation: ConstructorParameters<typeof ChatArchiveRepositoryError>[0],
    error: unknown,
  ): ChatArchiveRepositoryError {
    return error instanceof ChatArchiveRepositoryError
      ? error
      : new ChatArchiveRepositoryError(operation, error);
  }

  private static buildCompactedResult(args: {
    options: ConversationCompactionOptions;
    compactedHistory: ConversationCompactionResult['history'];
    archiveRecord: Awaited<ReturnType<ChatArchiveRepository['append']>>['archive'];
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

  private static createArchiveRepository(options: ConversationCompactionOptions): ChatArchiveRepository {
    return options.archiveRepository ?? new FileChatArchiveRepository({
      stateRoot: options.runtime.stateRoot,
    });
  }
}
