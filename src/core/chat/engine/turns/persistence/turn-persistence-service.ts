import { ConversationTurnArtifacts } from './turn-artifacts.js';
import { ChatArchiveRepositoryError } from '@/core/chat/engine/sessions/archives/index.js';
import type {
  PersistCompletedChatTurnBase,
  PersistChatTurnResult,
  PersistCompletedChatTurnArgs,
  PersistFinalCompactionRunningSeedArgs,
} from './types.js';

/**
 * Owns writing the completed turn back to the session catalog.
 */
export class ConversationTurnPersistenceService {
  static async persistCompleted(args: PersistCompletedChatTurnArgs): Promise<PersistChatTurnResult> {
    const artifactInput: PersistCompletedChatTurnBase = args;
    let persisted: PersistChatTurnResult;
    let runningSeedPersisted = false;
    try {
      persisted = await ConversationTurnArtifacts.persist({
        ...artifactInput,
        summarizer: args.summarizer,
        createTurnId: () => `server-turn-${Date.now()}`,
        onCompactionStatus: async (event) => {
          args.host.onCompactionStatus?.(event, 'final');
          if (event.status === 'running') {
            await ConversationTurnPersistenceService.persistFinalCompactionRunningSeed({
              ...args,
              archivePath: event.archivePath,
            });
            runningSeedPersisted = true;
          }
        },
      });
    } catch (error) {
      if (runningSeedPersisted && error instanceof ChatArchiveRepositoryError) {
        await args.sessionService.restoreCompactionState(args.session.id, {
          context: args.session.context,
          archives: args.session.archives,
          leaseClaim: args.leaseClaim,
        });
      }
      throw error;
    }

    const session = await args.sessionService.updateWithLease(args.session.id, args.leaseClaim, (latestSession) => ({
        ...persisted.session,
        queuedPrompts: latestSession.queuedPrompts,
      }));
    if (!session) {
      throw new Error(`Chat session not found: ${args.session.id}`);
    }
    return {
      ...persisted,
      session,
    };
  }

  static async persistFinalCompactionRunningSeed(
    args: PersistFinalCompactionRunningSeedArgs,
  ): Promise<void> {
    const sourceHistory = args.result.transcript;
    await args.sessionService.markCompactionRunning(args.session.id, {
      sourceHistory,
      archivePath: args.archivePath,
      leaseClaim: args.leaseClaim,
    });
  }
}
