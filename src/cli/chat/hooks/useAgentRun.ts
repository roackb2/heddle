import { useMemo } from 'react';
import type { MutableRefObject } from 'react';
import type { Logger } from 'pino';
import type { ChatMessage, LlmAdapter, RunResult, ToolCall, ToolDefinition } from '../../../index.js';
import {
  createLogger,
  createLlmAdapter,
  createDefaultAgentTools,
} from '../../../index.js';
import type { CyberLoopObserverAnnotation } from '../../../index.js';
import type { EditFilePreview } from '../../../core/tools/toolkits/coding-files/edit-file.js';
import type { PlanItem } from '../../../core/tools/toolkits/internal/update-plan.js';
import {
  formatMissingProviderCredentialMessage,
  hasProviderCredentialForModel,
  resolveApiKeyForModel,
  resolveProviderCredentialSourceForModel,
} from '../../../core/runtime/api-keys.js';
import { releaseSessionLease } from '../../../core/chat/session-lease.js';
import { generateSessionTitle } from '../../../core/chat/session-title.js';
import { isGenericSessionName } from '../state/storage.js';
import { normalizeSessionTitle } from '../utils/format.js';
import type { ApprovalChoice, ChatSession, LiveEvent, PendingApproval } from '../state/types.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import { useProjectApprovals } from './useProjectApprovals.js';
import {
  beginTuiAgentTurn,
  finishTuiAgentTurn,
} from './tui-agent-turn-lifecycle.js';
import { createTuiChatDriftObserver } from './tui-drift-observer.js';
import { executeTuiDirectShell } from './tui-direct-shell.js';
import { applyTuiAgentTurnFailure } from './tui-agent-turn-result.js';
import { executeTuiOrdinaryTurn } from './tui-ordinary-turn.js';

const PLAN_ITEM_STATUSES = new Set<PlanItem['status']>(['pending', 'in_progress', 'completed']);

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

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
  updateSessionById: SessionUpdater;
  referenceAssistantText?: string;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  isProjectApproved: (call: ToolCall) => boolean;
  rememberProjectApproval: (call: ToolCall) => void;
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
  updateActiveSession: ActiveSessionUpdater;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  isProjectApproved: (call: ToolCall) => boolean;
  rememberProjectApproval: (call: ToolCall) => void;
};

type UseAgentRunArgs = {
  runtime: ChatRuntimeConfig;
  activeModel: string;
  sessionTitleModel: string;
  activeSessionId: string;
  sessions: ChatSession[];
  state: ActionState;
  updateSessionById: SessionUpdater;
  updateActiveSession: ActiveSessionUpdater;
  drift?: ChatDriftObserverOptions;
};

export type ChatDriftObserverOptions = {
  enabled: boolean;
  onRunStart?: () => void;
  onAnnotation?: (annotation: CyberLoopObserverAnnotation) => void;
  onError?: (error: unknown) => void;
};

export function useAgentRun(args: UseAgentRunArgs) {
  const { runtime, activeModel, sessionTitleModel, activeSessionId, sessions, state, updateSessionById, updateActiveSession } = args;
  const projectApprovals = useProjectApprovals(runtime.approvalsFile);
  const activeApiKey = resolveApiKeyForModel(activeModel, runtime);
  const titleApiKey = resolveApiKeyForModel(sessionTitleModel, runtime);
  const titleCredentialSource = useMemo(
    () => resolveProviderCredentialSourceForModel(sessionTitleModel, runtime),
    [runtime, sessionTitleModel],
  );
  const activeCredentialSource = useMemo(
    () => resolveProviderCredentialSourceForModel(activeModel, runtime),
    [activeModel, runtime],
  );

  const llm = useMemo(
    () => createLlmAdapter({ model: activeModel, apiKey: activeApiKey, credentialStorePath: runtime.credentialStorePath }),
    [activeApiKey, activeModel, runtime.credentialStorePath],
  );
  const titleLlm = useMemo(
    () => createLlmAdapter({ model: sessionTitleModel, apiKey: titleApiKey, credentialStorePath: runtime.credentialStorePath }),
    [runtime.credentialStorePath, sessionTitleModel, titleApiKey],
  );
  const tools = useMemo(
    () => {
      return createDefaultAgentTools({
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
    if (!session || !isGenericSessionName(session.name) || titleCredentialSource.type === 'missing') {
      return;
    }

    void (async () => {
      try {
        const title = await generateSessionTitle({
          llm: titleLlm,
          prompt,
          responseText,
          normalize: normalizeSessionTitle,
        });
        if (!title) {
          return;
        }

        updateSessionById(sessionId, (candidate) =>
          isGenericSessionName(candidate.name) ? { ...candidate, name: title } : candidate,
        );
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
      updateSessionById,
      maybeAutoNameSession,
      isProjectApproved: projectApprovals.isApproved,
      rememberProjectApproval: projectApprovals.rememberApproval,
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
      updateActiveSession,
      maybeAutoNameSession,
      isProjectApproved: projectApprovals.isApproved,
      rememberProjectApproval: projectApprovals.rememberApproval,
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
    updateSessionById,
    referenceAssistantText,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
    drift,
  } = args;

  if (!prompt || state.isRunning) {
    return undefined;
  }

  if (!hasProviderCredentialForModel(llm.info?.model ?? runtime.model, runtime)) {
    state.setError(formatMissingProviderCredentialMessage(llm.info?.model ?? runtime.model));
    state.setStatus('Error');
    return undefined;
  }

  const turnAbortController = beginTuiAgentTurn(state);
  updateSessionById(sessionId, (session) => ({ ...session, lastContinuePrompt: prompt }));
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
      updateSessionById,
      parsePlanState: parsePlanStateFromToolResult,
      maybeAutoNameSession,
      isProjectApproved,
      rememberProjectApproval,
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
      updateSessionById,
    });
    return undefined;
  } finally {
    updateSessionById(sessionId, (sessionToUpdate) => releaseSessionLease(sessionToUpdate, leaseOwner));
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
    updateActiveSession,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
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
    updateActiveSession,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
  });
}
