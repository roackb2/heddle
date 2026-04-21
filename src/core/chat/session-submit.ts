import { join } from 'node:path';
import {
  createDefaultAgentTools,
  createLlmAdapter,
  DEFAULT_OPENAI_MODEL,
  inferProviderFromModel,
  runAgentLoop,
} from '../../index.js';
import type { ToolCall, ToolDefinition } from '../../index.js';
import { buildCompactionRunningContext, compactChatHistoryWithArchive, estimateChatHistoryTokens } from './compaction.js';
import { buildConversationMessages } from './conversation-lines.js';
import { formatChatFailureMessage } from './failure-messages.js';
import { acquireSessionLease, getSessionLeaseConflict, releaseSessionLease, type ChatSessionLeaseOwner } from './session-lease.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import type { ChatSession } from './types.js';
import { saveTrace } from './trace.js';
import { countAssistantSteps, summarizeTrace } from './trace-summary.js';
import { resolveApiKeyForModel } from '../../core/runtime/api-keys.js';

import type { AgentLoopEvent } from '../../index.js';

export type SubmitChatSessionPromptArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
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
  if (!apiKey) {
    throw new Error(`Missing provider API key for ${provider}`);
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
  const tools = createDefaultAgentTools({
    model,
    apiKey,
    workspaceRoot: args.workspaceRoot,
    memoryDir: join(args.stateRoot, 'memory'),
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
      memoryDir: join(args.stateRoot, 'memory'),
      llm,
      tools,
      includeDefaultTools: false,
      history: preflightSession.history,
      onEvent: args.onEvent,
      approveToolCall: args.approveToolCall,
      abortSignal: args.abortSignal,
    });

    const compacted = await compactChatHistoryWithArchive({
      history: result.transcript,
      model,
      sessionId: session.id,
      stateRoot: args.stateRoot,
      usage: result.usage,
      toolNames: tools.map((tool) => tool.name),
      goal: args.prompt,
      onStatusChange: (event) => {
        args.onCompactionStatus?.(event);
        if (event.status === 'running') {
          const compactionSeed = touchSession({
            ...preflightSession,
            history: result.transcript,
            context: buildCompactionRunningContext({
              history: result.transcript,
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
    const traceFile = saveTrace(join(args.stateRoot, 'traces'), result.trace);
    const nextTurn = {
      id: `server-turn-${Date.now()}`,
      prompt: args.prompt,
      outcome: result.outcome,
      summary: result.summary,
      steps: countAssistantSteps(result.trace),
      traceFile,
      events: summarizeTrace(result.trace),
    };

    const formattedSummary =
      result.outcome === 'error' ?
        formatChatFailureMessage(result.summary, {
          model,
          estimatedHistoryTokens: estimateChatHistoryTokens(session.history),
        })
      : result.summary;

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

    return {
      outcome: result.outcome,
      summary: formattedSummary,
      session: updatedSession,
    };
  } finally {
    clearChatSessionLease(args.sessionStoragePath, session.id, leaseOwner);
  }
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
