import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { ConversationTurnArtifacts } from './turn-artifacts.js';
import type {
  PersistCompletedChatTurnBase,
  PersistChatTurnResult,
  PersistCompletedChatTurnArgs,
  PersistFinalCompactionRunningContextArgs,
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
      onCompactionStatus: (event) => {
        args.host.onCompactionStatus?.(event, 'final');
        if (event.status === 'running') {
          ConversationTurnPersistenceService.persistFinalCompactionRunningSeed({
            ...args,
            archivePath: event.archivePath,
          });
        }
      },
    });

    const repository = args.sessionRepository;
    const latestSessions = repository.list();
    const latestSession = latestSessions.find((candidate) => candidate.id === args.session.id);
    const session = latestSession
      ? {
        ...persisted.session,
        queuedPrompts: latestSession.queuedPrompts,
      }
      : persisted.session;
    repository.save(latestSessions.map((candidate) => (candidate.id === args.session.id ? session : candidate)));
    return {
      ...persisted,
      session,
    };
  }

  static persistFinalCompactionRunningSeed(args: PersistFinalCompactionRunningSeedArgs) {
    const sourceHistory = args.result.transcript;
    const compactionSeed = ChatSessionRecords.touch({
      ...args.session,
      history: sourceHistory,
      context: ConversationTurnPersistenceService.buildRunningCompactionContext({
        ...args,
        sourceHistory,
      }),
    });
    args.sessionRepository
      .save(args.sessions.map((candidate) => (candidate.id === args.session.id ? compactionSeed : candidate)));
  }

  private static buildRunningCompactionContext(args: PersistFinalCompactionRunningContextArgs) {
    return ConversationCompactionService.buildSessionRunningContext({
      session: args.session,
      history: args.sourceHistory,
      lastArchivePath: args.archivePath,
    });
  }
}
