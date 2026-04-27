import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  appendMemoryCatalogSystemContext,
  createDefaultAgentTools,
  createLlmAdapter,
  DEFAULT_OPENAI_MODEL,
  inferProviderFromModel,
  runAgentLoop,
} from '../../index.js';
import type { AgentLoopResult, ToolCall, ToolDefinition } from '../../index.js';
import { runMaintenanceForRecordedCandidates } from '../memory/maintenance-integration.js';
import { buildCompactionRunningContext, compactChatHistoryWithArchive, estimateChatHistoryTokens } from './compaction.js';
import { buildConversationMessages } from './conversation-lines.js';
import { formatChatFailureMessage } from './failure-messages.js';
import { acquireSessionLease, getSessionLeaseConflict, releaseSessionLease, type ChatSessionLeaseOwner } from './session-lease.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import type { ChatSession } from './types.js';
import { saveTrace } from './trace.js';
import { countAssistantSteps, summarizeTrace } from './trace-summary.js';
import {
  formatMissingProviderCredentialMessage,
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
  resolveProviderCredentialSourceForModel,
} from '../../core/runtime/api-keys.js';

import type { AgentLoopEvent } from '../../index.js';

export type SubmitChatSessionPromptArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  onEvent?: (event: AgentLoopEvent) => void;
  onCompactionStatus?: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; summaryPath?: string; error?: string }) => void;
  approveToolCall?: (call: ToolCall, tool: ToolDefinition) => Promise<{ approved: boolean; reason?: string }>;
  abortSignal?: AbortSignal;
  leaseOwner?: ChatSessionLeaseOwner;
};

export async function submitChatSessionPrompt(args: SubmitChatSessionPromptArgs) {
  const sessions = loadChatSessions(args.sessionStoragePath, true);
  const session = sessions.find((candidate) => candidate.id === args.sessionId);
  if (!session) {
    throw new Error(`Chat session not found: ${args.sessionId}`);
  }

  const model = session.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = args.apiKey ?? resolveApiKeyForModel(model);
  const providerCredentialSource = resolveProviderCredentialSourceForModel(model, {
    apiKey,
    apiKeyProvider: args.apiKey ? 'explicit' : apiKey ? provider : undefined,
  });
  if (!hasProviderCredentialForModel(model, { apiKey: args.apiKey, apiKeyProvider: args.apiKey ? 'explicit' : undefined })) {
    throw new Error(formatMissingProviderCredentialMessage(model));
  }
  const leaseOwner = args.leaseOwner ?? {
    ownerKind: 'ask',
    ownerId: `submit-${process.pid}`,
    clientLabel: 'another Heddle client',
  };
  const leaseConflict = getSessionLeaseConflict(session, leaseOwner);
  if (leaseConflict) {
    throw new Error(leaseConflict);
  }
  const leasedSession = touchSession(acquireSessionLease(session, leaseOwner));
  saveChatSessions(
    args.sessionStoragePath,
    sessions.map((candidate) => candidate.id === session.id ? leasedSession : candidate),
  );

  const llm = createLlmAdapter({ model, apiKey });
  const memoryDir = join(args.stateRoot, 'memory');
  const systemContext = appendMemoryCatalogSystemContext({
    systemContext: args.systemContext,
    memoryRoot: memoryDir,
  });
  const tools = createDefaultAgentTools({
    model,
    apiKey,
    providerCredentialSource,
    workspaceRoot: args.workspaceRoot,
    memoryDir,
    searchIgnoreDirs: [],
    includePlanTool: true,
  });

  try {
    const preflightCompacted = await compactChatHistoryWithArchive({
      history: session.history,
      model,
      sessionId: session.id,
      stateRoot: args.stateRoot,
      toolNames: tools.map((tool) => tool.name),
      goal: args.prompt,
      systemContext,
      onStatusChange: (event) => {
        args.onCompactionStatus?.(event);
        if (event.status === 'running') {
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
    const preflightSession =
      preflightCompacted.history !== leasedSession.history || preflightCompacted.archives.length !== (leasedSession.archives?.length ?? 0) ?
        touchSession({
          ...leasedSession,
          history: preflightCompacted.history,
          context: preflightCompacted.context,
          archives: preflightCompacted.archives,
          messages: buildConversationMessages(preflightCompacted.history),
        })
      : leasedSession;
    if (preflightSession !== leasedSession) {
      saveChatSessions(
        args.sessionStoragePath,
        sessions.map((candidate) => candidate.id === session.id ? preflightSession : candidate),
      );
    }

    const result = await runAgentLoop({
      goal: args.prompt,
      model,
      apiKey,
      workspaceRoot: args.workspaceRoot,
      stateDir: args.stateRoot,
      memoryDir,
      llm,
      tools,
      includeDefaultTools: false,
      history: preflightSession.history,
      systemContext,
      onEvent: args.onEvent,
      approveToolCall: args.approveToolCall,
      abortSignal: args.abortSignal,
    });
    const maintenanceMode = args.memoryMaintenanceMode ?? 'background';
    const inlineMaintenance =
      maintenanceMode === 'inline' ?
        await runMaintenanceForRecordedCandidates({
          memoryRoot: memoryDir,
          llm,
          source: `chat session ${session.id}`,
          trace: result.trace,
          maxSteps: 20,
          onTraceEvent: (event) => args.onEvent?.({ type: 'trace', runId: result.state.runId, event, timestamp: new Date().toISOString() }),
        })
      : undefined;
    const resultTrace =
      inlineMaintenance && inlineMaintenance.events.length > 0 ?
        [...result.trace, ...inlineMaintenance.events]
      : result.trace;
    const resultForPersistence = {
      ...result,
      trace: resultTrace,
      state: {
        ...result.state,
        trace: resultTrace,
      },
    };

    const compacted = await compactChatHistoryWithArchive({
      history: resultForPersistence.transcript,
      model,
      sessionId: session.id,
      stateRoot: args.stateRoot,
      usage: resultForPersistence.usage,
      toolNames: tools.map((tool) => tool.name),
      goal: args.prompt,
      systemContext,
      onStatusChange: (event) => {
        args.onCompactionStatus?.(event);
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
    const traceFile = saveTrace(join(args.stateRoot, 'traces'), resultForPersistence.trace);
    const nextTurn = {
      id: `server-turn-${Date.now()}`,
      prompt: args.prompt,
      outcome: resultForPersistence.outcome,
      summary: resultForPersistence.summary,
      steps: countAssistantSteps(resultForPersistence.trace),
      traceFile,
      events: summarizeTrace(resultForPersistence.trace),
    };

    const formattedSummary =
      resultForPersistence.outcome === 'error' ?
        formatChatFailureMessage(resultForPersistence.summary, {
          model,
          estimatedHistoryTokens: estimateChatHistoryTokens(session.history),
        })
      : resultForPersistence.summary;

    const updatedSession: ChatSession = touchSession({
      ...preflightSession,
      lastContinuePrompt: args.prompt,
      history: compacted.history,
      context: compacted.context,
      archives: compacted.archives,
      lease: undefined,
      messages: buildConversationMessages(compacted.history),
      turns: [...preflightSession.turns, nextTurn].slice(-8),
    });

    const nextSessions = sessions.map((candidate) => candidate.id === session.id ? updatedSession : candidate);
    saveChatSessions(args.sessionStoragePath, nextSessions);
    if (maintenanceMode === 'background') {
      scheduleBackgroundMemoryMaintenance({
        memoryRoot: memoryDir,
        llm,
        source: `chat session ${session.id}`,
        trace: result.trace,
        traceFile,
        sessionStoragePath: args.sessionStoragePath,
        sessionId: session.id,
        runId: result.state?.runId ?? `session-${session.id}`,
        onEvent: args.onEvent,
      });
    }

    return {
      outcome: resultForPersistence.outcome,
      summary: formattedSummary,
      session: updatedSession,
    };
  } finally {
    clearChatSessionLease(args.sessionStoragePath, session.id, leaseOwner);
  }
}

function scheduleBackgroundMemoryMaintenance(args: {
  memoryRoot: string;
  llm: ReturnType<typeof createLlmAdapter>;
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

export function clearChatSessionLease(sessionStoragePath: string, sessionId: string, owner: ChatSessionLeaseOwner) {
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
