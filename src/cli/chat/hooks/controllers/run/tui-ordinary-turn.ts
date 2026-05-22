import type { RunResult } from '../../../../../index.js';
import { createConversationEngine } from '../../../../../core/chat/engine/index.js';
import type { ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import type { ChatSession } from '../../../state/types.js';
import type { ChatRuntimeConfig } from '../../../utils/runtime.js';
import type { ToolApprovalService } from '@/core/approvals/index.js';
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
  approvalService: ToolApprovalService;
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
    approvalService,
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
    approvalService,
  });
  const approvalPolicies = createTuiRememberedApprovalPolicies({ approvalService });

  const engine = createConversationEngine({
    workspaceRoot: runtime.workspaceRoot,
    stateRoot: runtime.stateRoot,
    sessionStoragePath: runtime.sessionCatalogFile,
    model: runtime.model,
    apiKey: runtime.apiKey,
    preferApiKey: runtime.preferApiKey,
    credentialStorePath: runtime.credentialStorePath,
    systemContext: runtime.systemContext,
    memoryMaintenanceMode: 'background',
    apiKeyPresent: runtime.providerCredentialPresent,
  });

  const result = await engine.turns.submit({
    sessionId,
    prompt,
    maxSteps: runtime.maxSteps,
    searchIgnoreDirs: runtime.searchIgnoreDirs,
    host: {
      events: {
        onEvent: (event) => {
          driftObserver?.observer.handleEvent(event);
        },
        onActivity: runLoopEvents.onActivity,
      },
      compaction: compactionPort,
      approvals: approvalPort,
      trace: {
        onEvent: runLoopEvents.onTraceEvent,
      },
    },
    approvalPolicies,
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
