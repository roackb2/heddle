import type { ChatMessage } from '../../../llm/types.js';
import type { TraceSummarizerRegistry } from '../../../observability/trace-summarizers.js';
import type { ProviderCredentialSource } from '../../../runtime/api-keys.js';
import type { AgentLoopResult } from '../../../runtime/agent-loop.js';
import { buildCompactionRunningContext } from '../history/compaction.js';
import { persistChatTurnResult, type PersistChatTurnResult } from './result.js';
import { saveChatSessions, touchSession } from '../sessions/storage.js';
import type { ChatTurnHostBridge } from './host-bridge.js';
import type { ChatSession } from '../../types.js';

export type PersistCompletedChatTurnArgs = {
  result: AgentLoopResult;
  prompt: string;
  session: ChatSession;
  sessions: ChatSession[];
  sessionStoragePath: string;
  model: string;
  stateRoot: string;
  traceDir: string;
  systemContext?: string;
  toolNames: string[];
  historyForTokenEstimate: ChatMessage[];
  credentialSource: ProviderCredentialSource;
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  hostBridge: Pick<ChatTurnHostBridge, 'notifyFinalCompactionStatus'>;
};

export async function persistCompletedChatTurn(args: PersistCompletedChatTurnArgs): Promise<PersistChatTurnResult> {
  const persisted = await persistChatTurnResult({
    result: args.result,
    prompt: args.prompt,
    session: args.session,
    model: args.model,
    stateRoot: args.stateRoot,
    traceDir: args.traceDir,
    systemContext: args.systemContext,
    toolNames: args.toolNames,
    historyForTokenEstimate: args.historyForTokenEstimate,
    summarizer: { credentialSource: args.credentialSource },
    traceSummarizerRegistry: args.traceSummarizerRegistry,
    createTurnId: () => `server-turn-${Date.now()}`,
    onCompactionStatus: (event) => {
      args.hostBridge.notifyFinalCompactionStatus(event);
      if (event.status === 'running') {
        persistFinalCompactionRunningSeed({
          ...args,
          archivePath: event.archivePath,
        });
      }
    },
  });

  saveChatSessions(
    args.sessionStoragePath,
    args.sessions.map((candidate) => (candidate.id === args.session.id ? persisted.session : candidate)),
  );
  return persisted;
}

function persistFinalCompactionRunningSeed(
  args: PersistCompletedChatTurnArgs & {
    archivePath?: string;
  },
) {
  const compactionSeed = touchSession({
    ...args.session,
    history: args.result.transcript,
    context: buildCompactionRunningContext({
      history: args.result.transcript,
      previous: args.session.context,
      archiveCount: args.session.archives?.length,
      currentSummaryPath: args.session.context?.currentSummaryPath,
      lastArchivePath: args.archivePath,
    }),
  });
  saveChatSessions(
    args.sessionStoragePath,
    args.sessions.map((candidate) => (candidate.id === args.session.id ? compactionSeed : candidate)),
  );
}
