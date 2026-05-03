import { runAgentLoop } from '../runtime/agent-loop.js';
import type { ToolApprovalPolicy } from '../approvals/types.js';
import type { TraceSummarizerRegistry } from '../observability/trace-summarizers.js';
import { releaseSessionLease, type ChatSessionLeaseOwner } from './session-lease.js';
import { prepareChatSessionTurn } from './session-turn-preflight.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import type { ChatTurnHostPort } from './turn-host.js';
import { createChatTurnHostBridge } from './turn-host-bridge.js';
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
  onAssistantStream?: Parameters<typeof runAgentLoop>[0]['onAssistantStream'];
  onTraceEvent?: Parameters<typeof runAgentLoop>[0]['onTraceEvent'];
  shouldStop?: Parameters<typeof runAgentLoop>[0]['shouldStop'];
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
  const hostBridge = createChatTurnHostBridge({
    host: args.host,
    onLegacyCompactionStatus: args.onCompactionStatus,
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
      maintenanceMode === 'inline' ?
        await runInlineTurnMemoryMaintenance({
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
