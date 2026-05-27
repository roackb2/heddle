import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { ChatSessionLeases } from '@/core/chat/engine/sessions/leases/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type {
  PersistPreflightRunningSeedArgs,
  PersistPreparedChatSessionTurnArgs,
  PreflightTurnCompactionRequest,
  PreflightTurnCompactionRuntime,
  PrepareChatSessionTurnArgs,
  PrepareChatSessionTurnResult,
} from './types.js';

/**
 * Owns pre-run session lease acquisition and preflight compaction persistence.
 */
export class ConversationTurnPreflightService {
  static async prepare(args: PrepareChatSessionTurnArgs): Promise<PrepareChatSessionTurnResult> {
    const persistedSession = new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
      .read(args.sessionId, true);
    const leaseConflict = persistedSession ? ChatSessionLeases.conflict(persistedSession, args.leaseOwner) : undefined;
    if (leaseConflict) {
      return {
        ok: false,
        reason: 'lease_conflict',
        message: leaseConflict,
      };
    }

    const leasedSession = persistedSession ? ChatSessionRecords.touch(ChatSessionLeases.acquire(persistedSession, args.leaseOwner)) : undefined;
    const initialHistory = leasedSession?.history ?? args.fallbackHistory;
    const compactionRuntime: PreflightTurnCompactionRuntime = args;
    const compactionRequest: PreflightTurnCompactionRequest = {
      toolNames: args.toolNames,
      goal: args.prompt,
    };
    const preflightCompacted = await ConversationCompactionService.compact({
      history: initialHistory,
      runtime: compactionRuntime,
      session: { id: args.sessionId },
      request: compactionRequest,
      summarizer: args.summarizer,
      onStatusChange: (event) => {
        args.host.onCompactionStatus?.(event, 'preflight');
        if (event.status === 'running' && leasedSession) {
          ConversationTurnPreflightService.persistRunningSeed({
            ...args,
            leasedSession,
            archivePath: event.archivePath,
          });
        }
      },
    });

    return ConversationTurnPreflightService.persistPrepared({
      ...args,
      session: persistedSession ?? ConversationTurnPreflightService.readRequiredFallbackSession(args.sessions, args.sessionId),
      compacted: preflightCompacted,
    });
  }

  static persistRunningSeed(args: PersistPreflightRunningSeedArgs) {
    const compactionSeed = ChatSessionRecords.touch({
      ...args.leasedSession,
      context: ConversationTurnPreflightService.buildRunningCompactionContext(args),
    });
    new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
      .save(args.sessions.map((candidate) => (candidate.id === args.sessionId ? compactionSeed : candidate)));
  }

  static persistPrepared(args: PersistPreparedChatSessionTurnArgs): Extract<PrepareChatSessionTurnResult, { ok: true }> {
    const preparedSession = ChatSessionRecords.touch(ChatSessionRecords.applyCompactedHistory({
      session: args.session,
      compacted: args.compacted,
      preserveAcceptedUserMessages: true,
    }));

    new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
      .save(args.sessions.map((candidate) => (candidate.id === args.session.id ? preparedSession : candidate)));

    return {
      ok: true,
      session: preparedSession,
      compacted: args.compacted,
    };
  }

  private static readRequiredFallbackSession(sessions: ChatSession[], sessionId: string): ChatSession {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    return session;
  }

  private static buildRunningCompactionContext(args: PersistPreflightRunningSeedArgs) {
    return ConversationCompactionService.buildSessionRunningContext({
      session: args.leasedSession,
      lastArchivePath: args.archivePath,
    });
  }

}
