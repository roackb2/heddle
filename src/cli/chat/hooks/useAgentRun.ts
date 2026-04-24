import { useMemo } from 'react';
import { readFileSync, writeFileSync } from 'node:fs';
import type { MutableRefObject } from 'react';
import type { Logger } from 'pino';
import type { ChatMessage, LlmAdapter, RunResult, ToolCall, ToolDefinition, ToolResult } from '../../../index.js';
import {
  createCyberLoopKinematicsObserver,
  createLogger,
  createLlmAdapter,
  createDefaultAgentTools,
  runAgentLoop,
} from '../../../index.js';
import { runMaintenanceForRecordedCandidates } from '../../../core/memory/maintenance-integration.js';
import type { CyberLoopKinematicsObserver, CyberLoopObserverAnnotation } from '../../../index.js';
import { DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES, runShellCommand } from '../../../core/tools/run-shell.js';
import { previewEditFileInput } from '../../../core/tools/edit-file.js';
import type { EditFilePreview } from '../../../core/tools/edit-file.js';
import type { PlanItem } from '../../../core/tools/update-plan.js';
import {
  appendDirectShellHistory,
  buildConversationMessages,
  countAssistantSteps,
  formatChatFailureMessage,
  formatEditPreviewHistoryMessage,
  formatPlanHistoryMessage,
  formatDirectShellResponse,
  shouldFallbackToMutate,
  summarizeTrace,
  summarizeToolCall,
  toLiveEvent,
} from '../utils/format.js';
import { saveTrace } from '../utils/runtime.js';
import { resolveApiKeyForModel } from '../utils/runtime.js';
import { acquireSessionLease, getSessionLeaseConflict, releaseSessionLease } from '../../../core/chat/session-lease.js';
import { createProjectApprovalRuleForCall, describeProjectApprovalRule } from '../state/approval-rules.js';
import { buildCompactionRunningContext, compactChatHistoryWithArchive, estimateChatHistoryTokens } from '../state/compaction.js';
import { isGenericSessionName, readChatSession, touchSession } from '../state/storage.js';
import { normalizeSessionTitle } from '../utils/format.js';
import type { ApprovalChoice, ChatSession, LiveEvent, PendingApproval, TurnSummary } from '../state/types.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import { useProjectApprovals } from './useProjectApprovals.js';

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

type ChatDriftObserverOptions = {
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

  const llm = useMemo(
    () => createLlmAdapter({ model: activeModel, apiKey: activeApiKey }),
    [activeApiKey, activeModel],
  );
  const titleLlm = useMemo(
    () => createLlmAdapter({ model: sessionTitleModel, apiKey: titleApiKey }),
    [sessionTitleModel, titleApiKey],
  );
  const tools = useMemo(
    () => {
      return createDefaultAgentTools({
        model: activeModel,
        apiKey: activeApiKey,
        workspaceRoot: runtime.workspaceRoot,
        memoryDir: runtime.memoryDir,
        searchIgnoreDirs: runtime.searchIgnoreDirs,
        includePlanTool: true,
      });
    },
    [activeApiKey, activeModel, runtime.memoryDir, runtime.searchIgnoreDirs, runtime.workspaceRoot],
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
    if (!session || !isGenericSessionName(session.name) || !titleApiKey) {
      return;
    }

    void (async () => {
      try {
        const result = await titleLlm.chat(
          [
            {
              role: 'system',
              content:
                'You name terminal chat sessions. Return only a short 3 to 6 word title in plain text. No quotes, no punctuation, no prefix.',
            },
            {
              role: 'user',
              content: `User prompt:\n${prompt}\n\nAssistant or tool summary:\n${responseText}\n\nCreate a concise session title.`,
            },
          ],
          [],
        );

        const title = normalizeSessionTitle(result.content);
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
    tools,
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

  if (!resolveApiKeyForModel(llm.info?.model ?? runtime.model, runtime)) {
    state.setError('Missing provider API key');
    state.setStatus('Error');
    return undefined;
  }

  state.setError(undefined);
  state.setIsRunning(true);
  state.setStatus('Running');
  state.interruptRequestedRef.current = false;
  state.setInterruptRequested(false);
  state.abortControllerRef.current = new AbortController();
  state.setLiveEvents([]);
  state.setCurrentEditPreview(undefined);
  state.setCurrentPlan(undefined);
  state.setCurrentAssistantText(undefined);
  updateSessionById(sessionId, (session) => ({ ...session, lastContinuePrompt: prompt }));
  const appendedEditPreviewIds = new Set<string>();
  const appendedPlanSteps = new Set<number>();
  const streamingBuffers = new Map<number, string>();
  drift?.onRunStart?.();
  let historyForRun = sessionHistory;
  const leaseOwner = {
    ownerKind: 'tui' as const,
    ownerId: `tui-${process.pid}`,
    clientLabel: 'terminal chat',
  };
  const persistedSession = readChatSession(runtime.sessionCatalogFile, sessionId, true);
  const leaseConflict = persistedSession ? getSessionLeaseConflict(persistedSession, leaseOwner) : undefined;
  if (leaseConflict) {
    state.setError(leaseConflict);
    state.setStatus('Blocked');
    state.setIsRunning(false);
    state.interruptRequestedRef.current = false;
    state.setInterruptRequested(false);
    state.abortControllerRef.current = undefined;
    updateSessionById(sessionId, (sessionToUpdate) => ({
      ...sessionToUpdate,
      lastContinuePrompt: undefined,
      messages: [
        ...sessionToUpdate.messages,
        { id: state.nextLocalId(), role: 'assistant', text: leaseConflict },
      ],
    }));
    return undefined;
  }
  if (persistedSession) {
    const leasedSession = touchSession(acquireSessionLease(persistedSession, leaseOwner));
    historyForRun = leasedSession.history;
    updateSessionById(sessionId, () => leasedSession);
  }
  const toolNames = tools.map((tool) => tool.name);
  const emitCompactionStatus = (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; error?: string }, sourceHistory: ChatMessage[]) => {
    if (event.status === 'running') {
      state.setStatus('Compacting');
      state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: 'Compacting earlier conversation history…' }].slice(-8));
      updateSessionById(sessionId, (sessionToUpdate) => ({
        ...sessionToUpdate,
        history: sourceHistory,
        context: buildCompactionRunningContext({
          history: sourceHistory,
          previous: sessionToUpdate.context,
          archiveCount: sessionToUpdate.archives?.length,
          currentSummaryPath: sessionToUpdate.context?.currentSummaryPath,
          lastArchivePath: event.archivePath,
        }),
      }));
      return;
    }

    if (event.status === 'failed') {
      state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: `Compaction failed: ${event.error ?? 'unknown error'}` }].slice(-8));
      return;
    }

    state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: 'Compaction finished.' }].slice(-8));
  };
  const preflightCompacted = await compactChatHistoryWithArchive({
    history: historyForRun,
    model: llm.info?.model ?? runtime.model,
    sessionId,
    stateRoot: runtime.stateRoot,
    systemContext: runtime.systemContext,
    toolNames,
    goal: prompt,
    onStatusChange: (event) => emitCompactionStatus(event, historyForRun),
  });
  historyForRun = preflightCompacted.history;
  updateSessionById(sessionId, (sessionToUpdate) => ({
    ...sessionToUpdate,
    history: preflightCompacted.history,
    context: preflightCompacted.context,
    archives: preflightCompacted.archives,
    messages: buildConversationMessages(preflightCompacted.history),
  }));
  state.setStatus('Running');
  const driftObserver = await createChatDriftObserver({
    prompt,
    referenceAssistantText,
    llm,
    runtime,
    logger,
    options: drift,
  });

  if (displayText) {
    updateSessionById(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, { id: state.nextLocalId(), role: 'user', text: displayText }],
    }));
  }

  try {
    const result = await runAgentLoop({
      goal: prompt,
      model: llm.info?.model ?? runtime.model,
      workspaceRoot: runtime.workspaceRoot,
      memoryDir: runtime.memoryDir,
      searchIgnoreDirs: runtime.searchIgnoreDirs,
      llm,
      tools,
      includeDefaultTools: false,
      maxSteps: runtime.maxSteps,
      logger,
      history: historyForRun,
      systemContext: runtime.systemContext,
      onAssistantStream: (update) => {
        streamingBuffers.set(update.step, update.text);
        state.setCurrentAssistantText(update.text || undefined);
        if (update.done) {
          streamingBuffers.delete(update.step);
        }
      },
      onTraceEvent: (event) => {
        if (event.type === 'assistant.turn' && event.content.trim()) {
          streamingBuffers.delete(event.step);
          state.setCurrentAssistantText(event.content);
        }

        if (event.type === 'tool.call' && event.call.tool === 'edit_file') {
          void previewEditFileInput(event.call.input).then((preview) => {
            if (!preview || appendedEditPreviewIds.has(event.call.id)) {
              return;
            }

            appendedEditPreviewIds.add(event.call.id);
            updateSessionById(sessionId, (session) => ({
              ...session,
              messages: [
                ...session.messages,
                {
                  id: state.nextLocalId(),
                  role: 'assistant',
                  text: formatEditPreviewHistoryMessage(preview),
                },
              ],
            }));
          });
        }

        if (event.type === 'tool.result') {
          if (event.tool === 'update_plan') {
            state.setCurrentPlan(parsePlanStateFromToolResult(event.result.output));

            if (!appendedPlanSteps.has(event.step)) {
              const renderedPlan = formatPlanHistoryMessage(event.result.output);
              if (renderedPlan) {
                appendedPlanSteps.add(event.step);
                updateSessionById(sessionId, (session) => ({
                  ...session,
                  messages: [
                    ...session.messages,
                    {
                      id: state.nextLocalId(),
                      role: 'assistant',
                      text: renderedPlan,
                    },
                  ],
                }));
              }
            }
          }
        }

        const next = toLiveEvent(event);
        if (!next) {
          return;
        }

        state.setLiveEvents((current) => {
          const previous = current[current.length - 1];
          if (previous?.text === next) {
            return current;
          }

          return [...current, { id: state.nextLocalId(), text: next }].slice(-8);
        });
      },
      onEvent: (event) => {
        driftObserver?.observer.handleEvent(event);
      },
      approveToolCall: async (call, tool) => {
        if (isProjectApproved(call)) {
          return {
            approved: true,
            reason: 'Approved by saved project rule',
          };
        }

        const editPreview = call.tool === 'edit_file' ? await previewEditFileInput(call.input) : undefined;

        return new Promise((resolve) => {
          const rememberedRule = createProjectApprovalRuleForCall(call);
          state.setPendingApproval({
            call,
            tool,
            editPreview,
            rememberForProject: () => rememberProjectApproval(call),
            rememberLabel: rememberedRule ? describeProjectApprovalRule(rememberedRule) : undefined,
            resolve,
          });
        });
      },
      shouldStop: () => state.interruptRequestedRef.current,
      abortSignal: state.abortControllerRef.current.signal,
    });
    await driftObserver?.observer.flush();
    if (driftObserver?.annotations.length) {
      result.trace.push(...driftObserver.annotations);
    }

    const compacted = await compactChatHistoryWithArchive({
      history: result.transcript,
      model: llm.info?.model ?? runtime.model,
      sessionId,
      stateRoot: runtime.stateRoot,
      usage: result.usage,
      systemContext: runtime.systemContext,
      toolNames,
      goal: prompt,
      onStatusChange: (event) => emitCompactionStatus(event, result.transcript),
    });
    updateSessionById(sessionId, (sessionToUpdate) => ({
      ...sessionToUpdate,
      history: compacted.history,
      context: compacted.context,
      archives: compacted.archives,
    }));

    const traceFile = saveTrace(runtime.traceDir, result.trace);
    const nextTurn: TurnSummary = {
      id: state.nextLocalId(),
      prompt,
      outcome: result.outcome,
      summary: result.summary,
      steps: countAssistantSteps(result.trace),
      traceFile,
      events: summarizeTrace(result.trace),
    };
    updateSessionById(sessionId, (sessionToUpdate) => ({
      ...sessionToUpdate,
      turns: [...sessionToUpdate.turns, nextTurn].slice(-8),
    }));

    const formattedSummary =
      result.outcome === 'error' ?
        formatChatFailureMessage(result.summary, {
          model: llm.info?.model ?? runtime.model,
          estimatedHistoryTokens: estimateChatHistoryTokens(historyForRun),
        })
      : result.summary;

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

    const assistantText = formattedSummary;
    maybeAutoNameSession(sessionId, prompt, assistantText);
    if (result.outcome === 'error') {
      state.setError(formattedSummary);
    }
    state.setStatus(result.outcome === 'done' ? 'Idle' : `Stopped: ${result.outcome}`);
    scheduleBackgroundMemoryMaintenance({
      runtime,
      llm,
      sessionId,
      trace: result.trace,
      traceFile,
      updateSessionById,
      nextLocalId: state.nextLocalId,
      setLiveEvents: state.setLiveEvents,
      setIsMemoryUpdating: state.setIsMemoryUpdating,
    });
    return result;
  } catch (runError) {
    await driftObserver?.observer.flush();
    const message = runError instanceof Error ? runError.message : String(runError);
    const formattedMessage = formatChatFailureMessage(message, {
      model: llm.info?.model ?? runtime.model,
      estimatedHistoryTokens: estimateChatHistoryTokens(historyForRun),
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
    return undefined;
  } finally {
    updateSessionById(sessionId, (sessionToUpdate) => releaseSessionLease(sessionToUpdate, leaseOwner));
    state.setIsRunning(false);
    state.interruptRequestedRef.current = false;
    state.setInterruptRequested(false);
    state.abortControllerRef.current = undefined;
  }
}

async function createChatDriftObserver(args: {
  prompt: string;
  referenceAssistantText?: string;
  llm: LlmAdapter;
  runtime: ChatRuntimeConfig;
  logger: Logger;
  options: ChatDriftObserverOptions | undefined;
}): Promise<CyberLoopKinematicsObserver | undefined> {
  const { prompt, referenceAssistantText, llm, runtime, logger, options } = args;
  if (!options?.enabled) {
    return undefined;
  }

  try {
    return await createCyberLoopKinematicsObserver({
      goal: prompt,
      referenceText: referenceAssistantText,
      apiKey: llm.info?.provider === 'openai' ? resolveApiKeyForModel(llm.info.model, runtime) : undefined,
      onAnnotation: options.onAnnotation,
      onError: (error) => {
        logger.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'CyberLoop drift observer failed',
        );
        options.onError?.(error);
      },
    });
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      'CyberLoop drift observer unavailable',
    );
    options.onError?.(error);
    return undefined;
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

  const shellDisplay = `!${command}`;
  const leaseOwner = {
    ownerKind: 'tui' as const,
    ownerId: `tui-${process.pid}`,
    clientLabel: 'terminal chat',
  };
  const persistedSession = readChatSession(runtime.sessionCatalogFile, activeSessionId, true) ?? activeSession;
  const leaseConflict = getSessionLeaseConflict(persistedSession, leaseOwner);
  if (leaseConflict) {
    state.setError(leaseConflict);
    state.setStatus('Blocked');
    updateActiveSession((session) => ({
      ...session,
      messages: [...session.messages, { id: state.nextLocalId(), role: 'assistant', text: leaseConflict }],
    }));
    return;
  }
  updateActiveSession(() => touchSession(acquireSessionLease(persistedSession, leaseOwner)));
  state.setError(undefined);
  state.setIsRunning(true);
  state.setStatus('Running');
  state.interruptRequestedRef.current = false;
  state.setInterruptRequested(false);
  state.abortControllerRef.current = new AbortController();
  state.setLiveEvents([{ id: state.nextLocalId(), text: `running direct shell (${command})` }]);
  updateActiveSession((session) => ({
    ...session,
    messages: [...session.messages, { id: state.nextLocalId(), role: 'user', text: shellDisplay }],
    lastContinuePrompt: undefined,
  }));

  try {
    const inspectCall: ToolCall = {
      id: `direct-shell-${Date.now()}-inspect`,
      tool: 'run_shell_inspect',
      input: { command },
    };
    const inspectResult = await runShellCommand(
      inspectCall.input,
      {
        toolName: inspectCall.tool,
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
      state.abortControllerRef.current.signal,
    );

    let chosenCall = inspectCall;
    let chosenResult: ToolResult = inspectResult;

    if (shouldFallbackToMutate(inspectResult.error)) {
      const mutateCall: ToolCall = {
        id: `direct-shell-${Date.now()}-mutate`,
        tool: 'run_shell_mutate',
        input: { command },
      };

      if (runtime.directShellApproval === 'always') {
        const directShellTool = tools.find((tool) => tool.name === 'run_shell_mutate');
        if (!directShellTool) {
          throw new Error('run_shell_mutate tool is not registered');
        }

        const approval =
          isProjectApproved(mutateCall) ?
            { approved: true, reason: 'Approved by saved project rule' }
          : await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
              const rememberedRule = createProjectApprovalRuleForCall(mutateCall);
              state.setPendingApproval({
                call: mutateCall,
                tool: directShellTool,
                rememberForProject: () => rememberProjectApproval(mutateCall),
                rememberLabel: rememberedRule ? describeProjectApprovalRule(rememberedRule) : undefined,
                resolve,
              });
            });

        if (!approval.approved) {
          const denialMessage = approval.reason ? `Command denied.\n${approval.reason}` : 'Command denied.';
          updateActiveSession((session) => ({
            ...session,
            messages: [...session.messages, { id: state.nextLocalId(), role: 'assistant', text: denialMessage }],
          }));
          state.setLiveEvents([
            {
              id: state.nextLocalId(),
              text: `approval denied for ${summarizeToolCall(mutateCall.tool, mutateCall.input)}`,
            },
          ]);
          state.setStatus('Idle');
          return;
        }
      }

      chosenCall = mutateCall;
      chosenResult = await runShellCommand(
        mutateCall.input,
        {
          toolName: mutateCall.tool,
          rules: DEFAULT_MUTATE_RULES,
          allowUnknown: true,
        },
        state.abortControllerRef.current.signal,
      );
    }

    const responseText = formatDirectShellResponse(chosenCall.tool, command, chosenResult);
    const directShellHistory = appendDirectShellHistory(activeSession.history, shellDisplay, chosenCall.tool, chosenResult);
    const compacted = await compactChatHistoryWithArchive({
      history: directShellHistory,
      model,
      sessionId: activeSessionId,
      stateRoot: runtime.stateRoot,
      systemContext: runtime.systemContext,
      toolNames: tools.map((tool) => tool.name),
      goal: shellDisplay,
      onStatusChange: (event) => {
        if (event.status === 'running') {
          state.setStatus('Compacting');
          state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: 'Compacting earlier conversation history…' }].slice(-8));
          updateActiveSession((session) => ({
            ...session,
            context: buildCompactionRunningContext({
              history: directShellHistory,
              previous: session.context,
              archiveCount: session.archives?.length,
              currentSummaryPath: session.context?.currentSummaryPath,
              lastArchivePath: event.archivePath,
            }),
          }));
        } else if (event.status === 'failed') {
          state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: `Compaction failed: ${event.error ?? 'unknown error'}` }].slice(-8));
        } else {
          state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: 'Compaction finished.' }].slice(-8));
        }
      },
    });
    updateActiveSession((session) => ({
      ...session,
      history: compacted.history,
      context: compacted.context,
      archives: compacted.archives,
      messages: buildConversationMessages(compacted.history),
    }));
    state.setLiveEvents([
      {
        id: state.nextLocalId(),
        text:
          chosenResult.ok ?
            `${summarizeToolCall(chosenCall.tool, chosenCall.input)} completed`
          : `${summarizeToolCall(chosenCall.tool, chosenCall.input)} failed`,
      },
    ]);
    state.setStatus(chosenResult.ok ? 'Idle' : 'Stopped: error');
    if (!chosenResult.ok && chosenResult.error) {
      state.setError(chosenResult.error);
    }
    maybeAutoNameSession(activeSessionId, shellDisplay, responseText);
  } catch (shellError) {
    const message = shellError instanceof Error ? shellError.message : String(shellError);
    state.setError(message);
    state.setStatus('Error');
    updateActiveSession((session) => ({
      ...session,
      messages: [
        ...session.messages,
        { id: state.nextLocalId(), role: 'assistant', text: `Direct shell execution failed:\n${message}` },
      ],
    }));
  } finally {
    updateActiveSession((session) => releaseSessionLease(session, leaseOwner));
    state.setPendingApproval(undefined);
    state.setApprovalChoice('approve');
    state.interruptRequestedRef.current = false;
    state.setInterruptRequested(false);
    state.abortControllerRef.current = undefined;
    state.setIsRunning(false);
  }
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
