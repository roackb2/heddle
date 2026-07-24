import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { ChatSessionLeases } from '@/core/chat/engine/sessions/leases/index.js';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import type { ConversationCompactionResult } from '@/core/chat/engine/compaction/index.js';
import { ChatArchiveRepositoryError } from '@/core/chat/engine/sessions/archives/index.js';
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
    const persistedSession = await args.sessionService.read(args.sessionId);
    const leaseConflict = persistedSession
      ? await args.sessionService.getLeaseConflict(args.sessionId, args.leaseOwner)
      : undefined;
    if (leaseConflict) {
      return {
        ok: false,
        reason: 'lease_conflict',
        message: leaseConflict,
      };
    }

    const leasedSession = persistedSession
      ? await args.sessionService.acquireLease(args.sessionId, args.leaseOwner)
      : undefined;
    if (!leasedSession) {
      throw new Error(`Chat session not found: ${args.sessionId}`);
    }
    const leaseClaim = ChatSessionLeases.claim(leasedSession);
    const initialHistory = leasedSession?.history ?? args.fallbackHistory;
    const compactionRuntime: PreflightTurnCompactionRuntime = args;
    const compactionRequest: PreflightTurnCompactionRequest = {
      toolNames: args.toolNames,
      goal: args.prompt,
    };
    let preflightCompacted: ConversationCompactionResult;
    let runningSeedPersisted = false;
    try {
      preflightCompacted = await ConversationCompactionService.compact({
        history: initialHistory,
        runtime: compactionRuntime,
        session: { id: args.sessionId },
        archiveRepository: args.archiveRepository,
        request: compactionRequest,
        summarizer: args.summarizer,
        onStatusChange: async (event) => {
          args.host.onCompactionStatus?.(event, 'preflight');
          if (event.status === 'running' && leasedSession) {
            await ConversationTurnPreflightService.persistRunningSeed({
              ...args,
              leasedSession,
              leaseClaim,
              archivePath: event.archivePath,
            });
            runningSeedPersisted = true;
          }
        },
      });
    } catch (error) {
      if (leasedSession && runningSeedPersisted && error instanceof ChatArchiveRepositoryError) {
        await args.sessionService.restoreCompactionState(args.sessionId, {
          context: leasedSession.context,
          archives: leasedSession.archives,
          leaseClaim,
        });
      }
      throw error;
    }

    return await ConversationTurnPreflightService.persistPrepared({
      ...args,
      session: persistedSession ?? await args.sessionService.require(args.sessionId),
      compacted: preflightCompacted,
      leaseClaim,
    });
  }

  static async persistRunningSeed(args: PersistPreflightRunningSeedArgs): Promise<void> {
    await args.sessionService.markCompactionRunning(args.sessionId, {
      sourceHistory: args.leasedSession.history,
      archivePath: args.archivePath,
      leaseClaim: args.leaseClaim,
    });
  }

  static async persistPrepared(
    args: PersistPreparedChatSessionTurnArgs,
  ): Promise<Extract<PrepareChatSessionTurnResult, { ok: true }>> {
    const preparedSession = await args.sessionService.updateWithLease(args.session.id, args.leaseClaim, (session) => (
      ChatSessionRecords.applyCompactedHistory({
        session,
        compacted: args.compacted,
        preserveAcceptedUserMessages: true,
      })
    ));
    if (!preparedSession) {
      throw new Error(`Chat session not found: ${args.session.id}`);
    }

    return {
      ok: true,
      session: preparedSession,
      compacted: args.compacted,
      leaseClaim: args.leaseClaim,
    };
  }

}
