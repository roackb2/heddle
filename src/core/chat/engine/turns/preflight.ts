import type { ChatMessage } from '../../../llm/types.js';
import { ConversationLines, ChatSessionRecords } from '../sessions/records/index.js';
import { buildCompactionRunningContext, compactChatHistoryWithArchive } from '../history/compaction.js';
import { ChatSessionLeases, type ChatSessionLeaseOwner } from '../sessions/leases/index.js';
import { FileChatSessionRepository } from '../sessions/repository/index.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession } from '../../types.js';
import type { ChatTurnHostBridge } from './host-bridge.js';

export type ChatTurnPreflightCompactionStatus = {
  status: 'running' | 'finished' | 'failed';
  archivePath?: string;
  summaryPath?: string;
  error?: string;
};

export type PrepareChatSessionTurnArgs = {
  sessionStoragePath: string;
  sessionId: string;
  fallbackHistory: ChatMessage[];
  prompt: string;
  model: string;
  stateRoot: string;
  systemContext?: string;
  toolNames: string[];
  summarizer: Parameters<typeof compactChatHistoryWithArchive>[0]['summarizer'];
  leaseOwner: ChatSessionLeaseOwner;
  sessions: ChatSession[];
  hostBridge: Pick<ChatTurnHostBridge, 'notifyPreflightCompactionStatus'>;
};

export type PrepareChatSessionTurnResult =
  | {
      ok: true;
      session?: ChatSession;
      historyForRun: ChatMessage[];
      preflightHistory: ChatMessage[];
      context: ChatContextStats;
      archives: ChatArchiveRecord[];
    }
  | {
      ok: false;
      reason: 'lease_conflict';
      message: string;
    };

export async function prepareChatSessionTurn(args: PrepareChatSessionTurnArgs): Promise<PrepareChatSessionTurnResult> {
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
  const preflightCompacted = await compactChatHistoryWithArchive({
    history: initialHistory,
    model: args.model,
    sessionId: args.sessionId,
    stateRoot: args.stateRoot,
    systemContext: args.systemContext,
    toolNames: args.toolNames,
    goal: args.prompt,
    summarizer: args.summarizer,
    onStatusChange: (event) => {
      args.hostBridge.notifyPreflightCompactionStatus(event);
      if (event.status === 'running' && leasedSession) {
        persistPreflightCompactionRunningSeed({
          sessionStoragePath: args.sessionStoragePath,
          sessions: args.sessions,
          sessionId: args.sessionId,
          leasedSession,
          archivePath: event.archivePath,
        });
      }
    },
  });

  return persistPreparedChatSessionTurn({
    sessionStoragePath: args.sessionStoragePath,
    sessions: args.sessions,
    session: persistedSession ?? readRequiredFallbackSession(args.sessions, args.sessionId),
    prepared: {
      ok: true,
      session: leasedSession
        ? {
            ...leasedSession,
            history: preflightCompacted.history,
            context: preflightCompacted.context,
            archives: preflightCompacted.archives,
            messages: ConversationLines.fromHistory(preflightCompacted.history),
          }
        : undefined,
      historyForRun: preflightCompacted.history,
      preflightHistory: preflightCompacted.history,
      context: preflightCompacted.context,
      archives: preflightCompacted.archives,
    },
  });
}

export function persistPreflightCompactionRunningSeed(args: {
  sessionStoragePath: string;
  sessions: ChatSession[];
  sessionId: string;
  leasedSession: ChatSession;
  archivePath?: string;
}) {
  const compactionSeed = ChatSessionRecords.touch({
    ...args.leasedSession,
    context: buildCompactionRunningContext({
      history: args.leasedSession.history,
      previous: args.leasedSession.context,
      archiveCount: args.leasedSession.archives?.length,
      currentSummaryPath: args.leasedSession.context?.currentSummaryPath,
      lastArchivePath: args.archivePath,
    }),
  });
  new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
    .save(args.sessions.map((candidate) => (candidate.id === args.sessionId ? compactionSeed : candidate)));
}

export function persistPreparedChatSessionTurn(args: {
  sessionStoragePath: string;
  sessions: ChatSession[];
  session: ChatSession;
  prepared: Extract<PrepareChatSessionTurnResult, { ok: true }>;
}): Extract<PrepareChatSessionTurnResult, { ok: true }> {
  const preparedSession =
    args.prepared.session ??
    ChatSessionRecords.touch({
      ...args.session,
      history: args.prepared.preflightHistory,
      context: args.prepared.context,
      archives: args.prepared.archives,
      messages: ConversationLines.fromHistory(args.prepared.preflightHistory),
    });

  new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
    .save(args.sessions.map((candidate) => (candidate.id === args.session.id ? preparedSession : candidate)));

  return {
    ...args.prepared,
    session: preparedSession,
  };
}

function readRequiredFallbackSession(sessions: ChatSession[], sessionId: string): ChatSession {
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`);
  }

  return session;
}
