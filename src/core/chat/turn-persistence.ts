import { join } from 'node:path';
import { buildCompactionRunningContext } from './compaction.js';
import { persistChatTurnResult, type PersistChatTurnResult } from './session-turn-result.js';
import { saveChatSessions, touchSession } from './storage.js';
import type { ChatSession } from './types.js';
import type { ChatTurnHostPort } from './turn-host.js';
import type { AgentLoopResult } from '../runtime/agent-loop.js';
import type { ChatMessage } from '../llm/types.js';
import type { ProviderCredentialSource } from '../runtime/api-keys.js';
import type { TraceSummarizerRegistry } from '../observability/trace-summarizers.js';

export type PersistCompletedChatTurnArgs = {
  result: AgentLoopResult;
  prompt: string;
  session: ChatSession;
  sessions: ChatSession[];
  sessionStoragePath: string;
  model: string;
  stateRoot: string;
  systemContext?: string;
  toolNames: string[];
  historyForTokenEstimate: ChatMessage[];
  credentialSource: ProviderCredentialSource;
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  host?: ChatTurnHostPort;
  onCompactionStatus?: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; summaryPath?: string; error?: string }) => void;
};

export async function persistCompletedChatTurn(args: PersistCompletedChatTurnArgs): Promise<PersistChatTurnResult> {
  return await persistChatTurnResult({
    result: args.result,
    prompt: args.prompt,
    session: args.session,
    model: args.model,
    stateRoot: args.stateRoot,
    traceDir: join(args.stateRoot, 'traces'),
    systemContext: args.systemContext,
    toolNames: args.toolNames,
    historyForTokenEstimate: args.historyForTokenEstimate,
    summarizer: { credentialSource: args.credentialSource },
    traceSummarizerRegistry: args.traceSummarizerRegistry,
    createTurnId: () => `server-turn-${Date.now()}`,
    onCompactionStatus: (event) => {
      args.onCompactionStatus?.(event);
      args.host?.compaction?.onFinalCompactionStatus?.(event);
      if (event.status === 'running') {
        persistFinalCompactionRunningSeed({
          ...args,
          archivePath: event.archivePath,
        });
      }
    },
  });
}

function persistFinalCompactionRunningSeed(args: PersistCompletedChatTurnArgs & {
  archivePath?: string;
}) {
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
    args.sessions.map((candidate) => candidate.id === args.session.id ? compactionSeed : candidate),
  );
}
