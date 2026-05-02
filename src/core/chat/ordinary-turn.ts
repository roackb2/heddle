import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentLoop } from '../../index.js';
import type { AgentLoopResult, RunAgentLoopOptions } from '../runtime/agent-loop.js';
import type { ToolCall, ToolDefinition } from '../types.js';
import type { LlmAdapter } from '../llm/types.js';
import { runMaintenanceForRecordedCandidates } from '../memory/maintenance-integration.js';
import { buildCompactionRunningContext } from './compaction.js';
import { buildConversationMessages } from './conversation-lines.js';
import { releaseSessionLease, type ChatSessionLeaseOwner } from './session-lease.js';
import { prepareChatSessionTurn } from './session-turn-preflight.js';
import { persistChatTurnResult } from './session-turn-result.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import { summarizeTrace } from './trace-summary.js';
import type { ChatTurnHostPort } from './turn-host.js';
import type { AgentLoopEvent } from '../runtime/events.js';
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
    const inlineMaintenance =
      maintenanceMode === 'inline' ?
        await runMaintenanceForRecordedCandidates({
          memoryRoot: runtime.memoryDir,
          llm: runtime.llm,
          source: `chat session ${session.id}`,
          trace: result.trace,
          maxSteps: 20,
          onTraceEvent: (event) => args.host?.events?.onAgentLoopEvent?.({
            type: 'trace',
            runId: result.state.runId,
            event,
            timestamp: new Date().toISOString(),
          } satisfies AgentLoopEvent),
        })
      : undefined;
    const resultTrace =
      inlineMaintenance && inlineMaintenance.events.length > 0 ?
        [...result.trace, ...inlineMaintenance.events]
      : result.trace;
    const resultForPersistence: AgentLoopResult = {
      ...result,
      trace: resultTrace,
      state: {
        ...result.state,
        trace: resultTrace,
      },
    };

    const persisted = await persistChatTurnResult({
      result: resultForPersistence,
      prompt: args.prompt,
      session: preflightSession,
      model: runtime.model,
      stateRoot: args.stateRoot,
      traceDir: join(args.stateRoot, 'traces'),
      systemContext: runtime.systemContext,
      toolNames,
      historyForTokenEstimate: session.history,
      summarizer: { credentialSource: runtime.providerCredentialSource },
      createTurnId: () => `server-turn-${Date.now()}`,
      onCompactionStatus: (event) => {
        args.onCompactionStatus?.(event);
        args.host?.compaction?.onFinalCompactionStatus?.(event);
        if (event.status === 'running') {
          const compactionSeed = touchSession({
            ...preflightSession,
            history: result.transcript,
            context: buildCompactionRunningContext({
              history: resultForPersistence.transcript,
              previous: preflightSession.context,
              archiveCount: preflightSession.archives?.length,
              currentSummaryPath: preflightSession.context?.currentSummaryPath,
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

    const nextSessions = sessions.map((candidate) => candidate.id === session.id ? persisted.session : candidate);
    saveChatSessions(args.sessionStoragePath, nextSessions);
    if (maintenanceMode === 'background') {
      scheduleBackgroundMemoryMaintenance({
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

function scheduleBackgroundMemoryMaintenance(args: {
  memoryRoot: string;
  llm: LlmAdapter;
  source: string;
  trace: AgentLoopResult['trace'];
  traceFile: string;
  sessionStoragePath: string;
  sessionId: string;
  runId: string;
  onEvent?: (event: AgentLoopEvent) => void;
}) {
  void (async () => {
    const maintenance = await runMaintenanceForRecordedCandidates({
      memoryRoot: args.memoryRoot,
      llm: args.llm,
      source: args.source,
      trace: args.trace,
      maxSteps: 20,
      onTraceEvent: (event) => args.onEvent?.({ type: 'trace', runId: args.runId, event, timestamp: new Date().toISOString() }),
    });
    if (maintenance.events.length === 0) {
      return;
    }

    const currentTrace = readTraceEvents(args.traceFile);
    const nextTrace = [...currentTrace, ...maintenance.events];
    writeFileSync(args.traceFile, `${JSON.stringify(nextTrace, null, 2)}\n`, 'utf8');

    const sessions = loadChatSessions(args.sessionStoragePath, true);
    const nextSessions = sessions.map((session) => {
      if (session.id !== args.sessionId) {
        return session;
      }

      return touchSession({
        ...session,
        turns: session.turns.map((turn, index) => (
          index === session.turns.length - 1 ?
            {
              ...turn,
              events: summarizeTrace(nextTrace),
            }
          : turn
        )),
      });
    });
    saveChatSessions(args.sessionStoragePath, nextSessions);
  })().catch((error) => {
    args.onEvent?.({
      type: 'trace',
      runId: args.runId,
      event: {
        type: 'memory.maintenance_failed',
        runId: `memory-run-${Date.now()}`,
        error: error instanceof Error ? error.message : String(error),
        candidateIds: [],
        step: nextTraceStep(args.trace),
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  });
}

function readTraceEvents(path: string): AgentLoopResult['trace'] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed as AgentLoopResult['trace'] : [];
  } catch {
    return [];
  }
}

function nextTraceStep(trace: AgentLoopResult['trace']): number {
  return trace.reduce((max, event) => 'step' in event ? Math.max(max, event.step) : max, 0) + 1;
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
