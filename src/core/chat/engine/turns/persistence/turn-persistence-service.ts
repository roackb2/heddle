import { buildSessionCompactionRunningContext } from '@/core/chat/engine/history/compaction.js';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
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

    new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
      .save(args.sessions.map((candidate) => (candidate.id === args.session.id ? persisted.session : candidate)));
    return persisted;
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
    new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
      .save(args.sessions.map((candidate) => (candidate.id === args.session.id ? compactionSeed : candidate)));
  }

  private static buildRunningCompactionContext(args: PersistFinalCompactionRunningContextArgs) {
    return buildSessionCompactionRunningContext({
      session: args.session,
      history: args.sourceHistory,
      lastArchivePath: args.archivePath,
    });
  }
}
