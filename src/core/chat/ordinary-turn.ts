import { runAgentLoop, type RunAgentLoopOptions } from '../runtime/agent-loop.js';
import type { ToolApprovalPolicy } from '../approvals/types.js';
import type { TraceSummarizerRegistry } from '../observability/trace-summarizers.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import { buildConversationMessages } from './conversation-lines.js';
import { releaseSessionLease, type ChatSessionLeaseOwner } from './session-lease.js';
import { persistPreflightCompactionRunningSeed, prepareChatSessionTurn } from './session-turn-preflight.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import type { ChatTurnHostPort } from './turn-host.js';
import { prepareOrdinaryChatTurnContext } from './turn-context.js';
import { runInlineTurnMemoryMaintenance, scheduleBackgroundTurnMemoryMaintenance } from './turn-memory-maintenance.js';
import { persistCompletedChatTurn } from './turn-persistence.js';

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
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  onCompactionStatus?: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; summaryPath?: string; error?: string }) => void;
  onAssistantStream?: RunAgentLoopOptions['onAssistantStream'];
  onTraceEvent?: RunAgentLoopOptions['onTraceEvent'];
  shouldStop?: RunAgentLoopOptions['shouldStop'];
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export async function executeOrdinaryChatTurn(args: ExecuteOrdinaryChatTurnArgs) {
  const context = prepareOrdinaryChatTurnContext({
    workspaceRoot: args.workspaceRoot,
    stateRoot: args.stateRoot,
    sessionStoragePath: args.sessionStoragePath,
    sessionId: args.sessionId,
    apiKey: args.apiKey,
    preferApiKey: args.preferApiKey,
    credentialStorePath: args.credentialStorePath,
    systemContext: args.systemContext,
    leaseOwner: args.leaseOwner,
  });
  const { sessions, session, runtime, tools, toolNames, leaseOwner } = context;

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
          persistPreflightCompactionRunningSeed({
            sessionStoragePath: args.sessionStoragePath,
            sessions,
            sessionId: session.id,
            leasedSession,
            archivePath: event.archivePath,
          });
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
      approvalPolicies: args.approvalPolicies,
      approveToolCall: createHostToolApprovalBridge(args.host),
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
      traceSummarizerRegistry: args.traceSummarizerRegistry,
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

function createHostToolApprovalBridge(host: ChatTurnHostPort | undefined): RunAgentLoopOptions['approveToolCall'] {
  if (!host?.approvals?.requestToolApproval) {
    return undefined;
  }

  return (call: ToolCall, tool: ToolDefinition) => (
    host.approvals?.requestToolApproval?.({ call, tool }) ?? Promise.resolve({ approved: false, reason: 'Missing approval port.' })
  );
}
