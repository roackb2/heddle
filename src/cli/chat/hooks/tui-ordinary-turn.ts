import type { RunResult } from '../../../index.js';
import { executeOrdinaryChatTurn } from '../../../core/chat/ordinary-turn.js';
import type { ChatSession } from '../state/types.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import { createTuiCompactionStatusPort } from './tui-compaction-status.js';
import { finalizeSuccessfulTuiOrdinaryTurn } from './tui-agent-turn-result.js';
import { createTuiRunLoopEventAdapter } from './tui-run-loop-events.js';
import { createTuiToolApprovalPort } from './tui-tool-approval.js';
import type { ActionState } from './useAgentRun.js';
import type { CyberLoopKinematicsObserver } from '../../../index.js';

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

type ParsePlanState = (output: unknown) => ActionState extends { setCurrentPlan: (value: infer T) => void } ? T : never;

export async function executeTuiOrdinaryTurn(args: {
  prompt: string;
  displayText?: string;
  sessionId: string;
  runtime: ChatRuntimeConfig;
  state: ActionState;
  updateSessionById: SessionUpdater;
  parsePlanState: ParsePlanState;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  isProjectApproved: Parameters<typeof createTuiToolApprovalPort>[0]['isProjectApproved'];
  rememberProjectApproval: Parameters<typeof createTuiToolApprovalPort>[0]['rememberProjectApproval'];
  driftObserver: CyberLoopKinematicsObserver | undefined;
  turnAbortSignal: AbortSignal;
  leaseOwner: { ownerKind: 'tui'; ownerId: string; clientLabel: string };
}): Promise<RunResult | undefined> {
  const {
    prompt,
    displayText,
    sessionId,
    runtime,
    state,
    updateSessionById,
    parsePlanState,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
    driftObserver,
    turnAbortSignal,
    leaseOwner,
  } = args;

  const compactionPort = createTuiCompactionStatusPort({
    state,
    sessionId,
    updateSessionById,
  });

  if (displayText) {
    updateSessionById(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, { id: state.nextLocalId(), role: 'user', text: displayText }],
    }));
  }

  const runLoopEvents = createTuiRunLoopEventAdapter({
    state,
    sessionId,
    updateSessionById,
    parsePlanState,
  });
  const approvalPort = createTuiToolApprovalPort({
    state,
    isProjectApproved,
    rememberProjectApproval,
  });

  const result = await executeOrdinaryChatTurn({
    workspaceRoot: runtime.workspaceRoot,
    stateRoot: runtime.stateRoot,
    sessionStoragePath: runtime.sessionCatalogFile,
    sessionId,
    prompt,
    apiKey: runtime.apiKey,
    preferApiKey: runtime.preferApiKey,
    credentialStorePath: runtime.credentialStorePath,
    systemContext: runtime.systemContext,
    memoryMaintenanceMode: 'background',
    host: {
      events: {
        onAgentLoopEvent: (event) => {
          driftObserver?.observer.handleEvent(event);
        },
      },
      compaction: compactionPort,
      approvals: approvalPort,
    },
    onAssistantStream: runLoopEvents.onAssistantStream,
    onTraceEvent: runLoopEvents.onTraceEvent,
    shouldStop: () => state.interruptRequestedRef.current,
    abortSignal: turnAbortSignal,
    leaseOwner,
  });

  if (!result) {
    return undefined;
  }

  const { readChatSession } = await import('../state/storage.js');
  const persistedSession = readChatSession(runtime.sessionCatalogFile, sessionId, true);
  if (!persistedSession) {
    return undefined;
  }

  const { latestHistory } = finalizeSuccessfulTuiOrdinaryTurn({
    persistedSession,
    displayText,
    outcome: result.outcome,
    prompt,
    sessionId,
    state,
    maybeAutoNameSession,
    updateSessionById,
  });

  return {
    outcome: result.outcome,
    summary: result.summary,
    transcript: latestHistory,
    trace: [],
    toolResults: [],
  } as RunResult;
}
