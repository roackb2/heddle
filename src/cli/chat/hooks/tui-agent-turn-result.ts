import { readFileSync, writeFileSync } from 'node:fs';
import type { ChatMessage, LlmAdapter, RunResult } from '../../../index.js';
import { runMaintenanceForRecordedCandidates } from '../../../core/memory/maintenance-integration.js';
import { createChatTurnPersistenceArtifacts } from '../../../core/chat/engine/turns/result.js';
import { estimateChatHistoryTokens } from '../state/compaction.js';
import { touchSession } from '../state/storage.js';
import type { ChatSession } from '../state/types.js';
import { toLiveEvent } from '../adapters/conversation-activity-adapter.js';
import { formatChatFailureMessage, summarizeTrace } from '../utils/format.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import type { ActionState } from './useAgentRun.js';
import type { TuiCompactionStatusEvent } from './tui-compaction-status.js';

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

export function adaptPersistedTuiOrdinaryTurn(args: {
  session: ChatSession;
  displayText?: string;
  outcome: RunResult['outcome'];
}): ChatSession {
  const { session, displayText, outcome } = args;

  return {
    ...session,
    messages: session.messages.map((message, index, messages) => {
      if (displayText && message.role === 'user' && index === messages.length - 2) {
        return { ...message, text: displayText };
      }

      if (outcome !== 'done' && message.role === 'assistant' && index === messages.length - 1) {
        return { ...message, text: `Run stopped: ${message.text}` };
      }

      return message;
    }),
  };
}

export async function applyTuiAgentTurnResult(args: {
  result: RunResult;
  prompt: string;
  sessionId: string;
  historyForRun: ChatMessage[];
  toolNames: string[];
  runtime: ChatRuntimeConfig;
  llm: LlmAdapter;
  state: ActionState;
  updateSessionById: SessionUpdater;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  emitCompactionStatus: (event: TuiCompactionStatusEvent, sourceHistory: RunResult['transcript']) => void;
}): Promise<void> {
  const {
    result,
    prompt,
    sessionId,
    historyForRun,
    toolNames,
    runtime,
    llm,
    state,
    updateSessionById,
    maybeAutoNameSession,
    emitCompactionStatus,
  } = args;
  const model = llm.info?.model ?? runtime.model;
  const artifacts = await createChatTurnPersistenceArtifacts({
    result,
    prompt,
    session: { id: sessionId, name: sessionId, history: [], messages: [], turns: [], createdAt: '', updatedAt: '' },
    model,
    stateRoot: runtime.stateRoot,
    traceDir: runtime.traceDir,
    systemContext: runtime.systemContext,
    toolNames,
    historyForTokenEstimate: historyForRun,
    summarizer: { credentialSource: runtime.providerCredentialSource },
    createTurnId: state.nextLocalId,
    onCompactionStatus: (event: TuiCompactionStatusEvent) => emitCompactionStatus(event, result.transcript),
  });
  updateSessionById(sessionId, (sessionToUpdate) => ({
    ...sessionToUpdate,
    history: artifacts.compacted.history,
    context: artifacts.compacted.context,
    archives: artifacts.compacted.archives,
    turns: [...sessionToUpdate.turns, artifacts.turn].slice(-8),
  }));

  const formattedSummary = artifacts.summary;

  state.setCurrentAssistantText(undefined);
  updateSessionById(sessionId, (sessionToUpdate) => ({
    ...sessionToUpdate,
    messages: [
      ...sessionToUpdate.messages,
      {
        id: state.nextLocalId(),
        role: 'assistant',
        text: result.outcome === 'done' ? formattedSummary : `Run stopped: ${formattedSummary}`,
      },
    ],
  }));

  maybeAutoNameSession(sessionId, prompt, formattedSummary);
  if (result.outcome === 'error') {
    state.setError(formattedSummary);
  }
  state.setStatus(result.outcome === 'done' ? 'Idle' : `Stopped: ${result.outcome}`);
  scheduleBackgroundMemoryMaintenance({
    runtime,
    llm,
    sessionId,
    trace: result.trace,
    traceFile: artifacts.traceFile,
    updateSessionById,
    nextLocalId: state.nextLocalId,
    setLiveEvents: state.setLiveEvents,
    setIsMemoryUpdating: state.setIsMemoryUpdating,
  });
}

export function finalizeSuccessfulTuiOrdinaryTurn(args: {
  persistedSession: ChatSession;
  displayText?: string;
  outcome: RunResult['outcome'];
  prompt: string;
  sessionId: string;
  state: ActionState;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  updateSessionById: SessionUpdater;
}) {
  const {
    persistedSession,
    displayText,
    outcome,
    prompt,
    sessionId,
    state,
    maybeAutoNameSession,
    updateSessionById,
  } = args;

  const sessionAfter = adaptPersistedTuiOrdinaryTurn({
    session: persistedSession,
    displayText,
    outcome,
  });
  const latestTurn = sessionAfter.turns.at(-1);
  const latestHistory = sessionAfter.history ?? [];
  const summaryText = latestTurn?.summary ?? sessionAfter.messages.at(-1)?.text ?? '';

  state.setCurrentAssistantText(undefined);
  maybeAutoNameSession(sessionId, prompt, summaryText);
  state.setStatus(outcome === 'done' ? 'Idle' : `Stopped: ${outcome}`);

  if (outcome === 'error') {
    state.setError(summaryText);
  }

  updateSessionById(sessionId, () => sessionAfter);

  return {
    session: sessionAfter,
    summaryText,
    latestHistory,
  };
}

export async function applyTuiAgentTurnFailure(args: {
  error: unknown;
  promptHistory: RunResult['transcript'];
  model: string;
  state: ActionState;
  sessionId: string;
  updateSessionById: SessionUpdater;
}): Promise<void> {
  const { error, promptHistory, model, state, sessionId, updateSessionById } = args;
  const message = error instanceof Error ? error.message : String(error);
  const formattedMessage = formatChatFailureMessage(message, {
    model,
    estimatedHistoryTokens: estimateChatHistoryTokens(promptHistory),
  });
  state.setError(formattedMessage);
  state.setStatus('Error');
  updateSessionById(sessionId, (sessionToUpdate) => ({
    ...sessionToUpdate,
    messages: [
      ...sessionToUpdate.messages,
      { id: state.nextLocalId(), role: 'assistant', text: `Run failed before a final answer: ${formattedMessage}` },
    ],
  }));
}

function scheduleBackgroundMemoryMaintenance(args: {
  runtime: ChatRuntimeConfig;
  llm: LlmAdapter;
  sessionId: string;
  trace: RunResult['trace'];
  traceFile: string;
  updateSessionById: SessionUpdater;
  nextLocalId: () => string;
  setLiveEvents: ActionState['setLiveEvents'];
  setIsMemoryUpdating: ActionState['setIsMemoryUpdating'];
}) {
  void (async () => {
    const maintenance = await runMaintenanceForRecordedCandidates({
      memoryRoot: args.runtime.memoryDir,
      llm: args.llm,
      source: `terminal chat session ${args.sessionId}`,
      trace: args.trace,
      maxSteps: 20,
      onTraceEvent: (event) => {
        if (event.type === 'memory.maintenance_started') {
          args.setIsMemoryUpdating(true);
        }
        const next = toLiveEvent(event);
        if (!next) {
          return;
        }
        args.setLiveEvents((current) => [...current, { id: args.nextLocalId(), text: next }].slice(-8));
      },
    });
    if (maintenance.events.length === 0) {
      return;
    }

    const currentTrace = readTraceEvents(args.traceFile);
    const nextTrace = [...currentTrace, ...maintenance.events];
    writeFileSync(args.traceFile, `${JSON.stringify(nextTrace, null, 2)}\n`, 'utf8');
    args.updateSessionById(args.sessionId, (session) => touchSession({
      ...session,
      turns: session.turns.map((turn, index) => (
        index === session.turns.length - 1 ?
          {
            ...turn,
            events: summarizeTrace(nextTrace),
          }
        : turn
      )),
    }));
    args.setIsMemoryUpdating(false);
  })().catch((error) => {
    args.setIsMemoryUpdating(false);
    args.setLiveEvents((current) => [
      ...current,
      {
        id: args.nextLocalId(),
        text: `Memory maintenance failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    ].slice(-8));
  });
}

function readTraceEvents(path: string): RunResult['trace'] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed as RunResult['trace'] : [];
  } catch {
    return [];
  }
}
