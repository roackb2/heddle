import { useMemo } from 'react';
import type { MutableRefObject } from 'react';
import type { Logger } from 'pino';
import type { ChatMessage, LlmAdapter, RunResult, ToolCall, ToolDefinition, ToolResult } from '../../../index.js';
import {
  createLogger,
  createLlmAdapter,
  createRunShellInspectTool,
  createRunShellMutateTool,
  createSearchFilesTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  reportStateTool,
  updatePlanTool,
  runAgent,
} from '../../../index.js';
import { DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES, runShellCommand } from '../../../tools/run-shell.js';
import { previewEditFileInput } from '../../../tools/edit-file.js';
import type { EditFilePreview } from '../../../tools/edit-file.js';
import type { PlanItem } from '../../../tools/update-plan.js';
import {
  appendDirectShellHistory,
  buildConversationMessages,
  countAssistantSteps,
  formatDirectShellResponse,
  shouldFallbackToMutate,
  summarizeTrace,
  summarizeToolCall,
  toLiveEvent,
} from '../utils/format.js';
import { saveTrace } from '../utils/runtime.js';
import { createProjectApprovalRuleForCall, describeProjectApprovalRule } from '../state/approval-rules.js';
import { compactChatHistory } from '../state/compaction.js';
import { isGenericSessionName } from '../state/storage.js';
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
  setInterruptRequested: (value: boolean) => void;
  setLiveEvents: StateSetter<LiveEvent[]>;
  setPendingApproval: (value: PendingApproval | undefined) => void;
  setApprovalChoice: (value: ApprovalChoice) => void;
  setCurrentEditPreview: (value: EditFilePreview | undefined) => void;
  setCurrentPlan: (value: { explanation?: string; items: PlanItem[] } | undefined) => void;
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
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  isProjectApproved: (call: ToolCall) => boolean;
  rememberProjectApproval: (call: ToolCall) => void;
};

type ExecuteDirectShellArgs = {
  rawCommand: string;
  model: string;
  activeSessionId: string;
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
};

export function useAgentRun(args: UseAgentRunArgs) {
  const { runtime, activeModel, sessionTitleModel, activeSessionId, sessions, state, updateSessionById, updateActiveSession } = args;
  const projectApprovals = useProjectApprovals(runtime.approvalsFile);

  const llm = useMemo(
    () => createLlmAdapter({ model: activeModel, apiKey: runtime.apiKey }),
    [activeModel, runtime.apiKey],
  );
  const titleLlm = useMemo(
    () => createLlmAdapter({ model: sessionTitleModel, apiKey: runtime.apiKey }),
    [runtime.apiKey, sessionTitleModel],
  );
  const tools = useMemo(
    () => [
      listFilesTool,
      readFileTool,
      editFileTool,
      createSearchFilesTool({ excludedDirs: runtime.searchIgnoreDirs }),
      reportStateTool,
      updatePlanTool,
      createRunShellInspectTool(),
      createRunShellMutateTool(),
    ],
    [runtime.searchIgnoreDirs],
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
    if (!session || !isGenericSessionName(session.name) || !runtime.apiKey) {
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
      runtime,
      llm,
      tools,
      logger,
      state,
      updateSessionById,
      maybeAutoNameSession,
      isProjectApproved: projectApprovals.isApproved,
      rememberProjectApproval: projectApprovals.rememberApproval,
    });
  };

  const executeDirectShellCommand = async (rawCommand: string) => {
    await runDirectShellAction({
      rawCommand,
      model: activeModel,
      activeSessionId,
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
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
  } = args;

  if (!prompt || state.isRunning) {
    return undefined;
  }

  if (!runtime.apiKey) {
    state.setError('Missing OpenAI API key');
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
  updateSessionById(sessionId, (session) => ({ ...session, lastContinuePrompt: prompt }));

  if (displayText) {
    updateSessionById(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, { id: state.nextLocalId(), role: 'user', text: displayText }],
    }));
  }

  try {
    const result = await runAgent({
      goal: prompt,
      llm,
      tools,
      maxSteps: runtime.maxSteps,
      logger,
      history: sessionHistory,
      systemContext: runtime.systemContext,
      onEvent: (event) => {
        if (event.type === 'tool.call' && event.call.tool === 'edit_file') {
          void previewEditFileInput(event.call.input).then((preview) => {
            state.setCurrentEditPreview(preview);
          });
        }

        if (event.type === 'tool.result') {
          if (event.tool === 'edit_file') {
            state.setCurrentEditPreview(undefined);
          }

          if (event.tool === 'update_plan') {
            state.setCurrentPlan(parsePlanStateFromToolResult(event.result.output));
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

    const compacted = compactChatHistory({
      history: result.transcript,
      model: llm.info?.model ?? runtime.model,
      usage: result.usage,
    });
    updateSessionById(sessionId, (sessionToUpdate) => ({
      ...sessionToUpdate,
      history: compacted.history,
      context: compacted.context,
      messages: buildConversationMessages(compacted.history),
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

    const assistantText =
      buildConversationMessages(compacted.history).filter((message) => message.role === 'assistant').at(-1)?.text ??
      result.summary;
    maybeAutoNameSession(sessionId, prompt, assistantText);
    if (result.outcome === 'error') {
      state.setError(result.summary);
    }
    state.setStatus(result.outcome === 'done' ? 'Idle' : `Stopped: ${result.outcome}`);
    state.setCurrentEditPreview(undefined);
    return result;
  } catch (runError) {
    const message = runError instanceof Error ? runError.message : String(runError);
    state.setError(message);
    state.setStatus('Error');
    updateSessionById(sessionId, (sessionToUpdate) => ({
      ...sessionToUpdate,
      messages: [
        ...sessionToUpdate.messages,
        { id: state.nextLocalId(), role: 'assistant', text: `Run failed before a final answer: ${message}` },
      ],
    }));
    return undefined;
  } finally {
    state.setIsRunning(false);
    state.interruptRequestedRef.current = false;
    state.setInterruptRequested(false);
    state.abortControllerRef.current = undefined;
  }
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
    runtime,
    tools,
    state,
    updateActiveSession,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
  } = args;

  const command = rawCommand.trim();
  if (!command || state.isRunning) {
    return;
  }

  const shellDisplay = `!${command}`;
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
    updateActiveSession((session) => ({
      ...session,
      ...(() => {
        const compacted = compactChatHistory({
          history: appendDirectShellHistory(session.history, shellDisplay, chosenCall.tool, chosenResult),
          model,
        });

        return {
          history: compacted.history,
          context: compacted.context,
          messages: buildConversationMessages(compacted.history),
        };
      })(),
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
    state.setPendingApproval(undefined);
    state.setApprovalChoice('approve');
    state.interruptRequestedRef.current = false;
    state.setInterruptRequested(false);
    state.abortControllerRef.current = undefined;
    state.setIsRunning(false);
  }
}
