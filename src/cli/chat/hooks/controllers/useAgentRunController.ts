import { useMemo } from 'react';
import type { MutableRefObject } from 'react';
import type { Logger } from 'pino';
import type { ChatMessage, LlmAdapter, RunResult, ToolDefinition } from '../../../../index.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import {
  createLogger,
  LlmAdapterService,
  RuntimeToolService,
} from '@/index.js';
import type { CyberLoopObserverAnnotation } from '@/index.js';
import type { EditFilePreview } from '@/core/tools/toolkits/coding-files/edit-file.js';
import type { PlanItem } from '@/core/tools/toolkits/internal/update-plan.js';
import {
  RuntimeCredentialService,
} from '@/core/runtime/credentials/index.js';
import { ToolApprovalService } from '@/core/approvals/index.js';
import { ChatSessionRecords, ChatSessionTitles } from '@/core/chat/engine/sessions/records/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';
import { normalizeSessionTitle } from '../../utils/format.js';
import type { ApprovalChoice, ChatSession, LiveEvent, PendingApproval } from '../../state/types.js';
import type { ChatRuntimeConfig } from '../../utils/runtime.js';
import {
  beginTuiAgentTurn,
  finishTuiAgentTurn,
} from './run/tui-agent-turn-lifecycle.js';
import { createTuiChatDriftObserver } from './run/tui-drift-observer.js';
import { executeTuiDirectShell } from './run/tui-direct-shell.js';
import { applyTuiAgentTurnFailure } from './run/tui-agent-turn-result.js';
import { executeTuiOrdinaryTurn } from './run/tui-ordinary-turn.js';

const PLAN_ITEM_STATUSES = new Set<PlanItem['status']>(['pending', 'in_progress', 'completed']);

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

// Migration escape hatch carried only for ordinary-turn finalization. Do not
// route new persisted session semantics through this type; add a named
// ConversationSessionService method or return the updated session from
// ConversationTurnService instead.
type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

export type ActionState = {
  isRunning: boolean;
  nextLocalId: () => string;
  setError: (value: string | undefined) => void;
  setStatus: (value: string) => void;
  setIsRunning: (value: boolean) => void;
  setIsMemoryUpdating: (value: boolean) => void;
  setInterruptRequested: (value: boolean) => void;
  setLiveEvents: StateSetter<LiveEvent[]>;
  setPendingApproval: (value: PendingApproval | undefined) => void;
  setApprovalChoice: (value: ApprovalChoice) => void;
  setCurrentEditPreview: (value: EditFilePreview | undefined) => void;
  setCurrentPlan: (value: { explanation?: string; items: PlanItem[] } | undefined) => void;
  setCurrentAssistantText: (value: string | undefined) => void;
  interruptRequestedRef: MutableRefObject<boolean>;
  abortControllerRef: MutableRefObject<AbortController | undefined>;
};

type ExecuteTurnArgs = {
  prompt: string;
  displayText?: string;
  sessionId: string;
  sessionHistory: ChatMessage[];
  runtime: ChatRuntimeConfig;
  llm: LlmAdapter;
  tools: ToolDefinition[];
  logger: Logger;
  state: ActionState;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  updateSessionById: SessionUpdater;
  referenceAssistantText?: string;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  approvalService: ToolApprovalService;
  drift?: ChatDriftObserverOptions;
};

type ExecuteDirectShellArgs = {
  rawCommand: string;
  model: string;
  activeSessionId: string;
  activeSession?: ChatSession;
  runtime: ChatRuntimeConfig;
  tools: ToolDefinition[];
  state: ActionState;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  approvalService: ToolApprovalService;
};

type UseAgentRunArgs = {
  runtime: ChatRuntimeConfig;
  activeModel: string;
  activeReasoningEffort?: ReasoningEffort;
  sessionTitleModel: string;
  activeSessionId: string;
  sessions: ChatSession[];
  state: ActionState;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  updateSessionById: SessionUpdater;
  drift?: ChatDriftObserverOptions;
};

export type ChatDriftObserverOptions = {
  enabled: boolean;
  onRunStart?: () => void;
  onAnnotation?: (annotation: CyberLoopObserverAnnotation) => void;
  onError?: (error: unknown) => void;
};

export function useAgentRunController(args: UseAgentRunArgs) {
  const { runtime, activeModel, activeReasoningEffort, sessionTitleModel, activeSessionId, sessions, state, sessionService, refreshSessions, updateSessionById } = args;
  const approvalService = useMemo(
    () => new ToolApprovalService({
      workspaceRoot: runtime.workspaceRoot,
      projectApprovalRulesFile: runtime.approvalsFile,
    }),
    [runtime.approvalsFile, runtime.workspaceRoot],
  );
  const activeApiKey = RuntimeCredentialService.resolveApiKeyForModel(activeModel, runtime);
  const titleApiKey = RuntimeCredentialService.resolveApiKeyForModel(sessionTitleModel, runtime);
  const titleCredentialSource = useMemo(
    () => RuntimeCredentialService.resolveCredentialSourceForModel(sessionTitleModel, runtime),
    [runtime, sessionTitleModel],
  );
  const activeCredentialSource = useMemo(
    () => RuntimeCredentialService.resolveCredentialSourceForModel(activeModel, runtime),
    [activeModel, runtime],
  );

  const llm = useMemo(
    () => LlmAdapterService.create({
      model: activeModel,
      credentials: {
        apiKey: activeApiKey,
        credentialStorePath: runtime.credentialStorePath,
      },
      runtime: {
        reasoningEffort: activeReasoningEffort,
      },
    }),
    [activeApiKey, activeModel, activeReasoningEffort, runtime.credentialStorePath],
  );
  const titleLlm = useMemo(
    () => LlmAdapterService.create({
      model: sessionTitleModel,
      credentials: {
        apiKey: titleApiKey,
        credentialStorePath: runtime.credentialStorePath,
      },
    }),
    [runtime.credentialStorePath, sessionTitleModel, titleApiKey],
  );
  const tools = useMemo(
    () => {
      return RuntimeToolService.createDefaultAgentTools({
        model: activeModel,
        apiKey: activeApiKey,
        providerCredentialSource: activeCredentialSource,
        credentialStorePath: runtime.credentialStorePath,
        workspaceRoot: runtime.workspaceRoot,
        memoryDir: runtime.memoryDir,
        searchIgnoreDirs: runtime.searchIgnoreDirs,
        includePlanTool: true,
      });
    },
    [
      activeApiKey,
      activeCredentialSource,
      activeModel,
      runtime.credentialStorePath,
      runtime.memoryDir,
      runtime.searchIgnoreDirs,
      runtime.workspaceRoot,
    ],
  );
  const logger = useMemo<Logger>(
    () =>
      createLogger({
        pretty: false,
        level: 'debug',
        console: false,
        logFilePath: runtime.logFile,
      }),
    [runtime.logFile],
  );

  const maybeAutoNameSession = (sessionId: string, prompt: string, responseText: string) => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session || !ChatSessionRecords.isGenericName(session.name) || titleCredentialSource.type === 'missing') {
      return;
    }

    void (async () => {
      try {
        const title = await ChatSessionTitles.generate({
          llm: titleLlm,
          prompt,
          responseText,
          normalize: normalizeSessionTitle,
        });
        if (!title) {
          return;
        }

        if (ChatSessionRecords.isGenericName(sessionService.require(sessionId).name)) {
          sessionService.rename(sessionId, title);
          refreshSessions();
        }
      } catch (titleError) {
        logger.debug(
          { error: titleError instanceof Error ? titleError.message : String(titleError), sessionId },
          'Session auto-title failed',
        );
      }
    })();
  };

  const executeTurn = async (prompt: string, displayText?: string, sessionIdOverride = activeSessionId) => {
    const session = sessions.find((candidate) => candidate.id === sessionIdOverride);
    await executeAgentTurn({
      prompt,
      displayText,
      sessionId: sessionIdOverride,
      sessionHistory: session?.history ?? [],
      referenceAssistantText: previousAssistantOutput(session),
      runtime,
      llm,
      tools,
      logger,
      state,
      sessionService,
      refreshSessions,
      updateSessionById,
      maybeAutoNameSession,
      approvalService,
      drift: args.drift,
    });
  };

  const executeDirectShellCommand = async (rawCommand: string) => {
    await runDirectShellAction({
      rawCommand,
      model: activeModel,
      activeSessionId,
      activeSession: sessions.find((candidate) => candidate.id === activeSessionId),
      runtime,
      tools,
      state,
      sessionService,
      refreshSessions,
      maybeAutoNameSession,
      approvalService,
    });
  };

  return {
    executeTurn,
    executeDirectShellCommand,
  };
}

export async function executeAgentTurn(args: ExecuteTurnArgs): Promise<RunResult | undefined> {
  const {
    prompt,
    displayText,
    sessionId,
    sessionHistory,
    runtime,
    llm,
    logger,
    state,
    sessionService,
    refreshSessions,
    updateSessionById,
    referenceAssistantText,
    maybeAutoNameSession,
    approvalService,
    drift,
  } = args;

  if (!prompt || state.isRunning) {
    return undefined;
  }

  if (!RuntimeCredentialService.hasCredentialForModel(llm.info?.model ?? runtime.model, runtime)) {
    state.setError(RuntimeCredentialService.formatMissingCredentialMessage(llm.info?.model ?? runtime.model));
    state.setStatus('Error');
    return undefined;
  }

  const turnAbortController = beginTuiAgentTurn(state);
  sessionService.setLastContinuePrompt(sessionId, prompt);
  refreshSessions();
  drift?.onRunStart?.();
  const leaseOwner = {
    ownerKind: 'tui' as const,
    ownerId: `tui-${process.pid}`,
    clientLabel: 'terminal chat',
  };
  state.setStatus('Running');
  const driftObserver = await createTuiChatDriftObserver({
    prompt,
    referenceAssistantText,
    llm,
    runtime,
    logger,
    options: drift,
  });

  try {
    const result = await executeTuiOrdinaryTurn({
      prompt,
      displayText,
      sessionId,
      runtime,
      state,
      sessionService,
      refreshSessions,
      updateSessionById,
      parsePlanState: parsePlanStateFromToolResult,
      maybeAutoNameSession,
      approvalService,
      driftObserver,
      turnAbortSignal: turnAbortController.signal,
      leaseOwner,
    });
    await driftObserver?.observer.flush();
    return result;
  } catch (runError) {
    await driftObserver?.observer.flush();
    await applyTuiAgentTurnFailure({
      error: runError,
      promptHistory: sessionHistory,
      model: llm.info?.model ?? runtime.model,
      state,
      sessionId,
      sessionService,
      refreshSessions,
    });
    return undefined;
  } finally {
    sessionService.releaseLease(sessionId, leaseOwner);
    refreshSessions();
    finishTuiAgentTurn(state);
  }
}

function previousAssistantOutput(session: ChatSession | undefined): string | undefined {
  if (!session) {
    return undefined;
  }

  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }

    const text = message.text.trim();
    if (!text || isNonResponseAssistantMessage(text)) {
      continue;
    }

    return text;
  }

  return undefined;
}

function isNonResponseAssistantMessage(text: string): boolean {
  return (
    text.startsWith('Heddle conversational mode.') ||
    text.startsWith('No provider credential detected.') ||
    text.startsWith('No provider API key detected.') ||
    text.startsWith('Enabled CyberLoop semantic drift detection') ||
    text.startsWith('Disabled CyberLoop semantic drift detection') ||
    text.startsWith('CyberLoop drift detection is ')
  );
}

function parsePlanStateFromToolResult(output: unknown): { explanation?: string; items: PlanItem[] } | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  const candidate = output as { explanation?: unknown; plan?: unknown };
  if (!Array.isArray(candidate.plan)) {
    return undefined;
  }

  const items = candidate.plan.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step : undefined;
    const status = (item as { status?: unknown }).status;
    if (!step || typeof status !== 'string' || !PLAN_ITEM_STATUSES.has(status as PlanItem['status'])) {
      return [];
    }

    return [{ step, status: status as PlanItem['status'] }];
  });

  if (items.length === 0) {
    return undefined;
  }

  return {
    explanation: typeof candidate.explanation === 'string' ? candidate.explanation : undefined,
    items,
  };
}

async function runDirectShellAction(args: ExecuteDirectShellArgs): Promise<void> {
  const {
    rawCommand,
    model,
    activeSessionId,
    activeSession,
    runtime,
    tools,
    state,
    sessionService,
    refreshSessions,
    maybeAutoNameSession,
    approvalService,
  } = args;

  const command = rawCommand.trim();
  if (!command || state.isRunning || !activeSession) {
    return;
  }

  await executeTuiDirectShell({
    command,
    shellDisplay: `!${command}`,
    model,
    activeSessionId,
    activeSession,
    runtime,
    tools,
    state,
    sessionService,
    refreshSessions,
    maybeAutoNameSession,
    approvalService,
  });
}
