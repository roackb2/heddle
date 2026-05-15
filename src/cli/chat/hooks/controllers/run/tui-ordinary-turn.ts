import type { RunResult } from '../../../../../index.js';
import { runConversationTurn } from '../../../../../core/chat/engine/turns/run-conversation-turn.js';
import type { ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import type { ChatSession } from '../../../state/types.js';
import type { ChatRuntimeConfig } from '../../../utils/runtime.js';
import { createTuiCompactionStatusPort } from './tui-compaction-status.js';
import { finalizeSuccessfulTuiOrdinaryTurn } from './tui-agent-turn-result.js';
import { createTuiRunLoopEventAdapter } from './tui-run-loop-events.js';
import { createTuiRememberedApprovalPolicies, createTuiToolApprovalPort } from './tui-tool-approval.js';
import type { ActionState } from '../useAgentRunController.js';
import type { CyberLoopKinematicsObserver } from '../../../../../index.js';

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

type ParsePlanState = (output: unknown) => ActionState extends { setCurrentPlan: (value: infer T) => void } ? T : never;

export async function executeTuiOrdinaryTurn(args: {
  prompt: string;
  displayText?: string;
  sessionId: string;
  runtime: ChatRuntimeConfig;
  state: ActionState;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  updateSessionById: SessionUpdater;
  parsePlanState: ParsePlanState;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  isProjectApproved: Parameters<typeof createTuiRememberedApprovalPolicies>[0]['isProjectApproved'];
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
    sessionService,
    refreshSessions,
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
    sessionService,
    refreshSessions,
  });

  if (displayText) {
    sessionService.appendMessage(sessionId, { id: state.nextLocalId(), role: 'user', text: displayText });
    refreshSessions();
  }

  const runLoopEvents = createTuiRunLoopEventAdapter({
    state,
    sessionId,
    sessionService,
    refreshSessions,
    parsePlanState,
  });
  const approvalPort = createTuiToolApprovalPort({
    state,
    rememberProjectApproval,
  });
  const approvalPolicies = createTuiRememberedApprovalPolicies({ isProjectApproved });

  // Desired shape: ordinary TUI turns should call
  // createConversationEngine(...).turns.submit after the shared turn service
  // exposes every TUI-required control, especially shouldStop, streaming,
  // trace events, compaction status, approval policy, and the updated session.
  // Until then, this is the remaining lower-level turn boundary violation.
  const result = await runConversationTurn({
    workspaceRoot: runtime.workspaceRoot,
    stateRoot: runtime.stateRoot,
    traceDir: runtime.traceDir,
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
          runLoopEvents.onAgentLoopEvent(event);
        },
      },
      compaction: compactionPort,
      approvals: approvalPort,
    },
    approvalPolicies,
    onAssistantStream: runLoopEvents.onAssistantStream,
    onTraceEvent: runLoopEvents.onTraceEvent,
    shouldStop: () => state.interruptRequestedRef.current,
    abortSignal: turnAbortSignal,
    leaseOwner,
  });

  if (!result) {
    return undefined;
  }

  const persistedSession = sessionService.require(sessionId);

  const { latestHistory } = finalizeSuccessfulTuiOrdinaryTurn({
    persistedSession,
    displayText,
    outcome: result.outcome as RunResult['outcome'],
    prompt,
    sessionId,
    state,
    maybeAutoNameSession,
    updateSessionById,
  });

  return {
    outcome: result.outcome as RunResult['outcome'],
    summary: result.summary,
    transcript: latestHistory,
    trace: [],
    toolResults: [],
  } as RunResult;
}
