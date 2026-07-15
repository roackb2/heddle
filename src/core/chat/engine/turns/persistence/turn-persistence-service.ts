import { ConversationTurnArtifacts } from './turn-artifacts.js';
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
    const persisted = await ConversationTurnArtifacts.persist({
      ...artifactInput,
      summarizer: { credentialSource: args.credentialSource },
      createTurnId: () => `server-turn-${Date.now()}`,
      onCompactionStatus: async (event) => {
        args.host.onCompactionStatus?.(event, 'final');
        if (event.status === 'running') {
          await ConversationTurnPersistenceService.persistFinalCompactionRunningSeed({
            ...args,
            archivePath: event.archivePath,
          });
        }
      },
    });

    const session = await args.sessionService.update(args.session.id, (latestSession) => ({
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
    });
  }
}
