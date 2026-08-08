import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { ChatArchiveRepositoryError } from '@/core/chat/engine/sessions/archives/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import type {
  RecoverConversationTurnContextArgs,
  RecoverConversationTurnContextResult,
} from './types.js';

/**
 * Owns lease-fenced, archive-backed recovery after a provider rejects one
 * model request for exceeding its context window.
 */
export class ConversationTurnContextRecoveryService {
  static async recover(
    args: RecoverConversationTurnContextArgs,
  ): Promise<RecoverConversationTurnContextResult> {
    if (args.failure.source !== 'model' || args.failure.code !== 'context_window') {
      return undefined;
    }

    const [systemMessage, ...history] = args.messages;
    if (!systemMessage || systemMessage.role !== 'system' || history.length === 0) {
      return undefined;
    }

    const sessionBeforeRecovery = await args.sessionService.require(args.sessionId);
    let runningSeedPersisted = false;
    let compacted: Awaited<ReturnType<typeof ConversationCompactionService.compact>>;
    try {
      compacted = await ConversationCompactionService.compact({
        history,
        runtime: {
          model: args.model,
          stateRoot: args.stateRoot,
          systemContext: args.systemContext,
        },
        session: { id: args.sessionId },
        archiveRepository: args.archiveRepository,
        request: {
          toolNames: args.toolNames,
          goal: args.prompt,
        },
        force: true,
        summarizer: args.summarizer,
        onStatusChange: async (event) => {
          args.host.onCompactionStatus?.(event, 'recovery');
          if (event.status !== 'running') {
            return;
          }

          await args.sessionService.markCompactionRunning(args.sessionId, {
            sourceHistory: history,
            archivePath: event.archivePath,
            leaseClaim: args.leaseClaim,
          });
          runningSeedPersisted = true;
        },
      });
    } catch (error) {
      if (runningSeedPersisted && error instanceof ChatArchiveRepositoryError) {
        await args.sessionService.restoreCompactionState(args.sessionId, {
          context: sessionBeforeRecovery.context,
          archives: sessionBeforeRecovery.archives,
          leaseClaim: args.leaseClaim,
        });
      }
      throw error;
    }

    const persistedSession = await args.sessionService.updateWithLease(
      args.sessionId,
      args.leaseClaim,
      (session) => ChatSessionRecords.applyCompactedHistory({
        session,
        compacted,
        preserveAcceptedUserMessages: true,
      }),
    );
    if (!persistedSession) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }

    if (!compacted.context.compaction?.compactedAt) {
      return undefined;
    }

    return {
      messages: [systemMessage, ...compacted.history],
    };
  }
}
