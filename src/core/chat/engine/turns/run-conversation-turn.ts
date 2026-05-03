import { runAgentLoop } from '../../../runtime/agent-loop.js';
import type { ToolApprovalPolicy } from '../../../approvals/types.js';
import type { TraceSummarizerRegistry } from '../../../observability/trace-summarizers.js';
import type { ConversationCompactionStatus } from '../../../observability/conversation-activity.js';
import { prepareConversationTurnContext } from './context.js';
import { createChatTurnHostBridge } from './host-bridge.js';
import { prepareChatSessionTurn } from './preflight.js';
import { runInlineTurnMemoryMaintenance, scheduleBackgroundTurnMemoryMaintenance } from './memory-maintenance.js';
import { persistCompletedChatTurn } from './persistence.js';
import { releaseSessionLease, type ChatSessionLeaseOwner } from '../sessions/lease.js';
import { loadChatSessions, saveChatSessions, touchSession } from '../sessions/storage.js';
import type { ChatTurnHostPort } from './host-bridge.js';

export type RunConversationTurnArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  traceDir: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  host?: ChatTurnHostPort;
  approvalPolicies?: ToolApprovalPolicy[];
  traceSummarizerRegistry?: TraceSummarizerRegistry;
  onCompactionStatus?: (event: ConversationCompactionStatus) => void;
  onAssistantStream?: Parameters<typeof runAgentLoop>[0]['onAssistantStream'];
  onTraceEvent?: Parameters<typeof runAgentLoop>[0]['onTraceEvent'];
  shouldStop?: Parameters<typeof runAgentLoop>[0]['shouldStop'];
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export type RunConversationTurnResult = {
  outcome: string;
  summary: string;
  session: Awaited<ReturnType<typeof persistCompletedChatTurn>>['session'];
};

export async function runConversationTurn(args: RunConversationTurnArgs): Promise<RunConversationTurnResult> {
  const context = prepareConversationTurnContext({
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
  const hostBridge = createChatTurnHostBridge({
    host: args.host,
    onCompactionStatus: args.onCompactionStatus,
  });

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
      sessions,
      hostBridge,
    });
    if (!preflight.ok) {
      throw new Error(preflight.message);
    }

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
      history: preflight.historyForRun,
      systemContext: runtime.systemContext,
      onAssistantStream: args.onAssistantStream,
      onTraceEvent: args.onTraceEvent,
      onEvent: hostBridge.onAgentLoopEvent,
      approvalPolicies: args.approvalPolicies,
      approveToolCall: hostBridge.approveToolCall,
      shouldStop: args.shouldStop,
      abortSignal: args.abortSignal,
    });
    const maintenanceMode = args.memoryMaintenanceMode ?? 'background';
    const resultForPersistence =
      maintenanceMode === 'inline'
        ? await runInlineTurnMemoryMaintenance({
            memoryRoot: runtime.memoryDir,
            llm: runtime.llm,
            source: `chat session ${session.id}`,
            result,
            onEvent: hostBridge.onAgentLoopEvent,
          })
        : result;

    const persisted = await persistCompletedChatTurn({
      result: resultForPersistence,
      prompt: args.prompt,
      session: preflight.session ?? session,
      sessions,
      sessionStoragePath: args.sessionStoragePath,
      model: runtime.model,
      stateRoot: args.stateRoot,
      traceDir: args.traceDir,
      systemContext: runtime.systemContext,
      toolNames,
      historyForTokenEstimate: session.history,
      credentialSource: runtime.providerCredentialSource,
      traceSummarizerRegistry: args.traceSummarizerRegistry,
      hostBridge,
    });

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
        onEvent: hostBridge.onAgentLoopEvent,
      });
    }

    return {
      outcome: resultForPersistence.outcome,
      summary: persisted.summary,
      session: persisted.session,
    };
  } finally {
    clearConversationTurnLease(args.sessionStoragePath, session.id, leaseOwner);
  }
}

export function clearConversationTurnLease(sessionStoragePath: string, sessionId: string, owner: ChatSessionLeaseOwner) {
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
