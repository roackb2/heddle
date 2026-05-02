import { runAgentLoop } from '../../index.js';
import type { RunAgentLoopOptions } from '../runtime/agent-loop.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import { buildCompactionRunningContext } from './compaction.js';
import { buildConversationMessages } from './conversation-lines.js';
import { releaseSessionLease, type ChatSessionLeaseOwner } from './session-lease.js';
import { prepareChatSessionTurn } from './session-turn-preflight.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import type { ChatTurnHostPort } from './turn-host.js';
import { runInlineTurnMemoryMaintenance, scheduleBackgroundTurnMemoryMaintenance } from './turn-memory-maintenance.js';
import { persistCompletedChatTurn } from './turn-persistence.js';
import { loadChatTurnSession } from './turn-session.js';
import { resolveChatTurnRuntime } from './turn-runtime.js';
import { createChatTurnTools, listChatTurnToolNames } from './turn-tools.js';

export type ExecuteOrdinaryChatTurnArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  host?: ChatTurnHostPort;
  onCompactionStatus?: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; summaryPath?: string; error?: string }) => void;
  onAssistantStream?: RunAgentLoopOptions['onAssistantStream'];
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
  shouldStop?: RunAgentLoopOptions['shouldStop'];
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export async function executeOrdinaryChatTurn(args: ExecuteOrdinaryChatTurnArgs) {
  const { sessions, session } = loadChatTurnSession({
    sessionStoragePath: args.sessionStoragePath,
    sessionId: args.sessionId,
  });
  const runtime = resolveChatTurnRuntime({
    stateRoot: args.stateRoot,
    sessionModel: session.model,
    apiKey: args.apiKey,
    preferApiKey: args.preferApiKey,
    credentialStorePath: args.credentialStorePath,
    systemContext: args.systemContext,
  });
  const tools = createChatTurnTools({
    model: runtime.model,
    apiKey: runtime.apiKey,
    providerCredentialSource: runtime.providerCredentialSource,
    credentialStorePath: args.credentialStorePath,
    workspaceRoot: args.workspaceRoot,
    memoryDir: runtime.memoryDir,
  });
  const toolNames = listChatTurnToolNames(tools);

  const leaseOwner = args.leaseOwner ?? {
    ownerKind: 'ask' as const,
    ownerId: `submit-${process.pid}`,
    clientLabel: 'another Heddle client',
  };

  try {
    const preflight = await prepareChatSessionTurn({
      sessionStoragePath: args.sessionStoragePath,
      sessionId: session.id,
      fallbackHistory: session.history,
      prompt: args.prompt,
      model: runtime.model,
      stateRoot: args.stateRoot,
      systemContext: runtime.systemContext,
      toolNames,
      summarizer: { credentialSource: runtime.providerCredentialSource },
      leaseOwner,
      onCompactionStatus: (event, _sourceHistory, leasedSession) => {
        args.onCompactionStatus?.(event);
        args.host?.compaction?.onPreflightCompactionStatus?.(event);
        if (event.status === 'running' && leasedSession) {
          const compactionSeed = touchSession({
            ...leasedSession,
            context: buildCompactionRunningContext({
              history: leasedSession.history,
              previous: leasedSession.context,
              archiveCount: leasedSession.archives?.length,
              currentSummaryPath: leasedSession.context?.currentSummaryPath,
              lastArchivePath: event.archivePath,
            }),
          });
          saveChatSessions(
            args.sessionStoragePath,
            sessions.map((candidate) => candidate.id === session.id ? compactionSeed : candidate),
          );
        }
      },
    });
    if (!preflight.ok) {
      throw new Error(preflight.message);
    }
    const preflightSession = preflight.session ?? touchSession({
      ...session,
      history: preflight.preflightHistory,
      context: preflight.context,
      archives: preflight.archives,
      messages: buildConversationMessages(preflight.preflightHistory),
    });
    saveChatSessions(
      args.sessionStoragePath,
      sessions.map((candidate) => candidate.id === session.id ? preflightSession : candidate),
    );

    const result = await runAgentLoop({
      goal: args.prompt,
      model: runtime.model,
      apiKey: runtime.apiKey,
      workspaceRoot: args.workspaceRoot,
      stateDir: args.stateRoot,
      memoryDir: runtime.memoryDir,
      llm: runtime.llm,
      tools,
      includeDefaultTools: false,
      history: preflightSession.history,
      systemContext: runtime.systemContext,
      onAssistantStream: args.onAssistantStream,
      onTraceEvent: args.onTraceEvent,
      onEvent: args.host?.events?.onAgentLoopEvent,
      approveToolCall: args.host?.approvals?.requestToolApproval ?
        ((call: ToolCall, tool: ToolDefinition) => args.host?.approvals?.requestToolApproval?.({ call, tool }) ?? Promise.resolve({ approved: false, reason: 'Missing approval port.' }))
      : undefined,
      shouldStop: args.shouldStop,
      abortSignal: args.abortSignal,
    });
    const maintenanceMode = args.memoryMaintenanceMode ?? 'background';
    const resultForPersistence =
      maintenanceMode === 'inline' ?
        await runInlineTurnMemoryMaintenance({
          memoryRoot: runtime.memoryDir,
          llm: runtime.llm,
          source: `chat session ${session.id}`,
          result,
          onEvent: args.host?.events?.onAgentLoopEvent,
        })
      : result;

    const persisted = await persistCompletedChatTurn({
      result: resultForPersistence,
      prompt: args.prompt,
      session: preflightSession,
      sessions,
      sessionStoragePath: args.sessionStoragePath,
      model: runtime.model,
      stateRoot: args.stateRoot,
      systemContext: runtime.systemContext,
      toolNames,
      historyForTokenEstimate: session.history,
      credentialSource: runtime.providerCredentialSource,
      host: args.host,
      onCompactionStatus: args.onCompactionStatus,
    });

    const nextSessions = sessions.map((candidate) => candidate.id === session.id ? persisted.session : candidate);
    saveChatSessions(args.sessionStoragePath, nextSessions);
    if (maintenanceMode === 'background') {
      scheduleBackgroundTurnMemoryMaintenance({
        memoryRoot: runtime.memoryDir,
        llm: runtime.llm,
        source: `chat session ${session.id}`,
        trace: result.trace,
        traceFile: persisted.traceFile,
        sessionStoragePath: args.sessionStoragePath,
        sessionId: session.id,
        runId: result.state?.runId ?? `session-${session.id}`,
        onEvent: args.host?.events?.onAgentLoopEvent,
      });
    }

    return {
      outcome: resultForPersistence.outcome,
      summary: persisted.summary,
      session: persisted.session,
    };
  } finally {
    clearOrdinaryChatTurnLease(args.sessionStoragePath, session.id, leaseOwner);
  }
}

export function clearOrdinaryChatTurnLease(sessionStoragePath: string, sessionId: string, owner: ChatSessionLeaseOwner) {
  const sessions = loadChatSessions(sessionStoragePath, true);
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session?.lease) {
    return;
  }

  const released = releaseSessionLease(session, owner);
  if (released === session) {
    return;
  }

  saveChatSessions(
    sessionStoragePath,
    sessions.map((candidate) => candidate.id === sessionId ? touchSession(released) : candidate),
  );
}
