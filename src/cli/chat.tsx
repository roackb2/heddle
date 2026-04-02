import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { ToolCall } from '../index.js';
import {
  runAgent,
  createOpenAiAdapter,
  listFilesTool,
  readFileTool,
  editFileTool,
  createSearchFilesTool,
  reportStateTool,
  createRunShellInspectTool,
  createRunShellMutateTool,
  createLogger,
} from '../index.js';
import { DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES, runShellCommand } from '../tools/run-shell.js';
import type { ApprovalChoice, ChatSession, LiveEvent, PendingApproval, TurnSummary } from './chat-types.js';
import {
  appendDirectShellHistory,
  buildConversationMessages,
  countAssistantSteps,
  formatDirectShellResponse,
  normalizeInlineText,
  normalizeSessionTitle,
  shouldFallbackToMutate,
  summarizeTrace,
  summarizeToolCall,
  toLiveEvent,
} from './chat-format.js';
import { runLocalCommand } from './chat-local-commands.js';
import {
  ActivityPanel,
  ApprovalComposer,
  CommandHintPanel,
  ConversationPanel,
  PromptInput,
  RecentTurnsPanel,
  shouldShowCommandHint,
  shouldShowSlashHints,
  SlashHintPanel,
} from './chat-panels.js';
import {
  createChatSession,
  createInitialMessages,
  isGenericSessionName,
  loadChatSessions,
  saveChatSessions,
  summarizeSession,
  touchSession,
} from './chat-storage.js';
import { resolveChatRuntimeConfig, saveTrace } from './chat-runtime.js';
import type { ChatCliOptions, ChatRuntimeConfig } from './chat-runtime.js';

const workingFrames = ['.', '..', '...'];
const SESSION_TITLE_MODEL = 'gpt-5.1-codex-mini';
export type { ChatCliOptions } from './chat-runtime.js';

function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextIdRef = useRef(0);
  const nextSessionNumberRef = useRef(2);
  const initialSessionsRef = useRef<ChatSession[] | undefined>(undefined);
  if (!initialSessionsRef.current) {
    initialSessionsRef.current = loadChatSessions(runtime.sessionsFile, Boolean(runtime.apiKey));
  }

  const [activeModel, setActiveModel] = useState(runtime.model);
  const llm = useMemo(
    () => createOpenAiAdapter({ model: activeModel, apiKey: runtime.apiKey }),
    [activeModel, runtime.apiKey],
  );
  const titleLlm = useMemo(
    () => createOpenAiAdapter({ model: SESSION_TITLE_MODEL, apiKey: runtime.apiKey }),
    [runtime.apiKey],
  );
  const tools = useMemo(
    () => [
      listFilesTool,
      readFileTool,
      editFileTool,
      createSearchFilesTool({ excludedDirs: runtime.searchIgnoreDirs }),
      reportStateTool,
      createRunShellInspectTool(),
      createRunShellMutateTool(),
    ],
    [runtime.searchIgnoreDirs],
  );
  const logger = useMemo(
    () =>
      createLogger({
        pretty: false,
        level: 'debug',
        console: false,
        logFilePath: runtime.logFile,
      }),
    [runtime.logFile],
  );

  const [sessions, setSessions] = useState<ChatSession[]>(initialSessionsRef.current);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionsRef.current[0]?.id ?? 'session-1');
  const [status, setStatus] = useState('Idle');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [workingFrame, setWorkingFrame] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | undefined>();
  const [approvalChoice, setApprovalChoice] = useState<ApprovalChoice>('approve');
  const [interruptRequested, setInterruptRequested] = useState(false);
  const interruptRequestedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);

  const nextLocalId = () => `ui-${Date.now()}-${nextIdRef.current++}`;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];
  const turns = activeSession?.turns ?? [];

  const updateSessionById = (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((current) =>
      current.map((session) => (session.id === sessionId ? touchSession(updater(session)) : session)),
    );
  };

  const updateActiveSession = (updater: (session: ChatSession) => ChatSession) => {
    updateSessionById(activeSessionId, updater);
  };

  useEffect(() => {
    saveChatSessions(runtime.sessionsFile, sessions);
  }, [runtime.sessionsFile, sessions]);

  useEffect(() => {
    if (!sessions.some((session) => session.id === activeSessionId) && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (sessions.length > 0) {
      return;
    }

    const fallback = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: Boolean(runtime.apiKey),
    });
    setSessions([fallback]);
    setActiveSessionId(fallback.id);
  }, [runtime.apiKey, sessions]);

  const createSession = (name?: string) => {
    const id = `session-${Date.now()}`;
    const nextSession = createChatSession({
      id,
      name: name?.trim() || `Session ${nextSessionNumberRef.current++}`,
      apiKeyPresent: Boolean(runtime.apiKey),
    });
    setSessions((current) => [touchSession(nextSession), ...current].slice(0, 24));
    setActiveSessionId(id);
    return nextSession;
  };

  const switchSession = (id: string) => {
    setActiveSessionId(id);
    setStatus('Idle');
    setError(undefined);
    setDraft('');
    setLiveEvents([]);
    setPendingApproval(undefined);
    setApprovalChoice('approve');
    setInterruptRequested(false);
    interruptRequestedRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    setIsRunning(false);
  };

  const renameSession = (name: string) => {
    updateActiveSession((session) => ({ ...session, name }));
  };

  const removeSession = (id: string) => {
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== id);
      if (remaining.length > 0) {
        return remaining;
      }

      return [
        createChatSession({
          id: 'session-1',
          name: 'Session 1',
          apiKeyPresent: Boolean(runtime.apiKey),
        }),
      ];
    });

    if (id === activeSessionId) {
      const next = sessions.find((session) => session.id !== id);
      setActiveSessionId(next?.id ?? 'session-1');
      setStatus('Idle');
      setError(undefined);
      setLiveEvents([]);
    }
  };

  const recentSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8),
    [sessions],
  );

  const activeSessionSummary = activeSession ? summarizeSession(activeSession) : undefined;
  const listRecentSessionsMessage =
    recentSessions.length > 0 ?
      [
        'Recent sessions:',
        ...recentSessions.map(
          (session, index) =>
            `${session.id === activeSessionId ? '*' : `${index + 1}.`} ${session.id} (${session.name})`,
        ),
        '',
        'Use /session switch <id> to jump to one, or /session continue <id> to switch and resume immediately.',
      ]
    : ['No saved sessions yet.'];

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

        setSessions((current) =>
          current.map((candidate) =>
            candidate.id === sessionId && isGenericSessionName(candidate.name) ?
              touchSession({ ...candidate, name: title })
            : candidate,
          ),
        );
      } catch (titleError) {
        logger.debug(
          { error: titleError instanceof Error ? titleError.message : String(titleError), sessionId },
          'Session auto-title failed',
        );
      }
    })();
  };

  useInput((input, key) => {
    if (!pendingApproval) {
      if (isRunning && key.escape) {
        interruptRequestedRef.current = true;
        setInterruptRequested(true);
        abortControllerRef.current?.abort();
      }
      return;
    }

    if (key.leftArrow || key.upArrow || key.tab) {
      setApprovalChoice('approve');
      return;
    }

    if (key.rightArrow || key.downArrow) {
      setApprovalChoice('deny');
      return;
    }

    if (key.return) {
      const approved = approvalChoice === 'approve';
      pendingApproval.resolve({
        approved,
        reason: approved ? 'Approved in chat UI' : 'Denied in chat UI',
      });
      setPendingApproval(undefined);
      setApprovalChoice('approve');
      return;
    }

    const normalized = input.toLowerCase();
    if (normalized === 'y') {
      setApprovalChoice('approve');
      return;
    }

    if (normalized === 'n') {
      setApprovalChoice('deny');
      return;
    }

    if (key.escape) {
      pendingApproval.resolve({ approved: false, reason: 'Denied in chat UI' });
      setPendingApproval(undefined);
      setApprovalChoice('approve');
    }
  }, { isActive: Boolean(pendingApproval) || isRunning });

  useEffect(() => {
    if (!isRunning) {
      setWorkingFrame(0);
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setWorkingFrame((current) => (current + 1) % workingFrames.length);
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 300);

    return () => clearInterval(timer);
  }, [isRunning]);

  const executeTurn = async (prompt: string, displayText?: string, sessionIdOverride = activeSessionId) => {
    if (!prompt || isRunning) {
      return;
    }

    if (!runtime.apiKey) {
      setError('Missing OpenAI API key');
      setStatus('Error');
      return;
    }

    setError(undefined);
    setIsRunning(true);
    setStatus('Running');
    interruptRequestedRef.current = false;
    setInterruptRequested(false);
    abortControllerRef.current = new AbortController();
    setLiveEvents([]);
    updateSessionById(sessionIdOverride, (session) => ({ ...session, lastContinuePrompt: prompt }));

    if (displayText) {
      updateSessionById(sessionIdOverride, (session) => ({
        ...session,
        messages: [...session.messages, { id: nextLocalId(), role: 'user', text: displayText }],
      }));
    }

    const session = sessions.find((candidate) => candidate.id === sessionIdOverride);
    const sessionHistory = session?.history ?? [];

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
          const next = toLiveEvent(event);
          if (!next) {
            return;
          }

          setLiveEvents((current) => {
            const previous = current[current.length - 1];
            if (previous?.text === next) {
              return current;
            }

            return [...current, { id: nextLocalId(), text: next }].slice(-8);
          });
        },
        approveToolCall: (call, tool) =>
          new Promise((resolve) => {
            setPendingApproval({ call, tool, resolve });
          }),
        shouldStop: () => interruptRequestedRef.current,
        abortSignal: abortControllerRef.current.signal,
      });

      updateSessionById(sessionIdOverride, (sessionToUpdate) => ({
        ...sessionToUpdate,
        history: result.transcript,
        messages: buildConversationMessages(result.transcript),
      }));

      const traceFile = saveTrace(runtime.traceDir, result.trace);
      const nextTurn: TurnSummary = {
        id: nextLocalId(),
        prompt,
        outcome: result.outcome,
        summary: result.summary,
        steps: countAssistantSteps(result.trace),
        traceFile,
        events: summarizeTrace(result.trace),
      };
      updateSessionById(sessionIdOverride, (sessionToUpdate) => ({
        ...sessionToUpdate,
        turns: [...sessionToUpdate.turns, nextTurn].slice(-8),
      }));

      const assistantText =
        buildConversationMessages(result.transcript).filter((message) => message.role === 'assistant').at(-1)?.text ??
        result.summary;
      maybeAutoNameSession(sessionIdOverride, prompt, assistantText);
      if (result.outcome === 'error') {
        setError(result.summary);
      }
      setStatus(result.outcome === 'done' ? 'Idle' : `Stopped: ${result.outcome}`);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      setError(message);
      setStatus('Error');
      updateSessionById(sessionIdOverride, (sessionToUpdate) => ({
        ...sessionToUpdate,
        messages: [
          ...sessionToUpdate.messages,
          { id: nextLocalId(), role: 'assistant', text: `Run failed before a final answer: ${message}` },
        ],
      }));
    } finally {
      setIsRunning(false);
      interruptRequestedRef.current = false;
      setInterruptRequested(false);
      abortControllerRef.current = undefined;
    }
  };

  const executeDirectShellCommand = async (rawCommand: string) => {
    const command = rawCommand.trim();
    if (!command || isRunning) {
      return;
    }

    const shellDisplay = `!${command}`;
    setError(undefined);
    setIsRunning(true);
    setStatus('Running');
    interruptRequestedRef.current = false;
    setInterruptRequested(false);
    abortControllerRef.current = new AbortController();
    setLiveEvents([{ id: nextLocalId(), text: `running direct shell (${command})` }]);
    updateActiveSession((session) => ({
      ...session,
      messages: [...session.messages, { id: nextLocalId(), role: 'user', text: shellDisplay }],
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
        abortControllerRef.current.signal,
      );

      let chosenCall = inspectCall;
      let chosenResult = inspectResult;

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

          const approval = await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
            setPendingApproval({ call: mutateCall, tool: directShellTool, resolve });
          });

          if (!approval.approved) {
            const denialMessage = approval.reason ? `Command denied.\n${approval.reason}` : 'Command denied.';
            updateActiveSession((session) => ({
              ...session,
              messages: [...session.messages, { id: nextLocalId(), role: 'assistant', text: denialMessage }],
            }));
            setLiveEvents([
              {
                id: nextLocalId(),
                text: `approval denied for ${summarizeToolCall(mutateCall.tool, mutateCall.input)}`,
              },
            ]);
            setStatus('Idle');
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
          abortControllerRef.current.signal,
        );
      }

      const responseText = formatDirectShellResponse(chosenCall.tool, command, chosenResult);
      updateActiveSession((session) => ({
        ...session,
        messages: [...session.messages, { id: nextLocalId(), role: 'assistant', text: responseText }],
        history: appendDirectShellHistory(session.history, shellDisplay, chosenCall.tool, chosenResult),
      }));
      setLiveEvents([
        {
          id: nextLocalId(),
          text:
            chosenResult.ok ?
              `${summarizeToolCall(chosenCall.tool, chosenCall.input)} completed`
            : `${summarizeToolCall(chosenCall.tool, chosenCall.input)} failed`,
        },
      ]);
      setStatus(chosenResult.ok ? 'Idle' : 'Stopped: error');
      if (!chosenResult.ok && chosenResult.error) {
        setError(chosenResult.error);
      }
      maybeAutoNameSession(activeSessionId, shellDisplay, responseText);
    } catch (shellError) {
      const message = shellError instanceof Error ? shellError.message : String(shellError);
      setError(message);
      setStatus('Error');
      updateActiveSession((session) => ({
        ...session,
        messages: [
          ...session.messages,
          { id: nextLocalId(), role: 'assistant', text: `Direct shell execution failed:\n${message}` },
        ],
      }));
    } finally {
      setPendingApproval(undefined);
      setApprovalChoice('approve');
      interruptRequestedRef.current = false;
      setInterruptRequested(false);
      abortControllerRef.current = undefined;
      setIsRunning(false);
    }
  };

  const submitPrompt = async (value: string) => {
    const prompt = normalizeInlineText(value);
    if (!prompt || isRunning) {
      return;
    }

    if (prompt.startsWith('!')) {
      await executeDirectShellCommand(prompt.slice(1).trim());
      return;
    }

    const commandResult = runLocalCommand({
      prompt,
      activeModel,
      setActiveModel,
      sessions,
      recentSessions,
      activeSessionId,
      switchSession,
      createSession,
      renameSession,
      removeSession,
      clearConversation: () => {
        updateActiveSession((session) => ({
          ...session,
          history: [],
          turns: [],
          lastContinuePrompt: undefined,
          messages: createInitialMessages(Boolean(runtime.apiKey)),
        }));
      },
      listRecentSessionsMessage,
    });

    if (commandResult.handled) {
      if (commandResult.kind === 'message') {
        updateActiveSession((session) => ({
          ...session,
          messages: [...session.messages, { id: nextLocalId(), role: 'assistant', text: commandResult.message }],
        }));
        setStatus('Idle');
        return;
      }

      if (commandResult.sessionId) {
        switchSession(commandResult.sessionId);
      }

      const targetId = commandResult.sessionId ?? activeSessionId;
      const targetSession = sessions.find((session) => session.id === targetId) ?? activeSession;
      const targetHistory = targetSession?.history ?? [];
      const targetContinuePrompt = targetSession?.lastContinuePrompt;

      const continueMessage = commandResult.message;
      if (continueMessage) {
        updateSessionById(targetId, (session) => ({
          ...session,
          messages: [...session.messages, { id: nextLocalId(), role: 'assistant', text: continueMessage }],
        }));
      }

      if (!targetHistory.length || !targetContinuePrompt) {
        updateSessionById(targetId, (session) => ({
          ...session,
          messages: [
            ...session.messages,
            { id: nextLocalId(), role: 'assistant', text: 'There is no interrupted or prior run to continue yet.' },
          ],
        }));
        setStatus('Idle');
        return;
      }

      if (!continueMessage) {
        updateSessionById(targetId, (session) => ({
          ...session,
          messages: [
            ...session.messages,
            { id: nextLocalId(), role: 'assistant', text: 'Continuing from the current transcript.' },
          ],
        }));
      }

      await executeTurn('Continue from where you left off.', 'Continue', targetId);
      return;
    }

    await executeTurn(prompt, prompt);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Heddle Chat</Text>
        <Text color="cyan">model={activeModel} maxSteps={runtime.maxSteps} cwd={runtime.workspaceRoot}</Text>
        <Text dimColor>
          session={activeSession?.name ?? 'unknown'} id={activeSession?.id ?? 'unknown'}
          {activeSessionSummary ? ` • ${activeSessionSummary}` : ''}
        </Text>
        <Text dimColor>logs={runtime.logFile}</Text>
        <Text color={error ? 'red' : isRunning ? 'yellow' : 'green'}>
          status={pendingApproval ? 'awaiting approval' : interruptRequested ? 'interrupt requested' : isRunning ? 'running' : status}
        </Text>
        <Text dimColor>/model &lt;name&gt; • /models • /session list • /help • !command</Text>
        <Text dimColor>
          {pendingApproval ? '←/→ choose • Enter confirms • Esc denies • Ctrl+C exits'
          : isRunning ? 'Esc requests stop after the current step • Ctrl+C exits'
          : 'Cmd+Backspace or Ctrl+U clears to line start • Ctrl+C exits'}
        </Text>
        {error ? <Text color="red">{error}</Text> : null}
      </Box>

      {isRunning ?
        <>
          <ConversationPanel messages={messages} />
          <RecentTurnsPanel turns={turns} />
          <ActivityPanel
            isRunning={isRunning}
            workingFrame={workingFrame}
            elapsedSeconds={elapsedSeconds}
            liveEvents={liveEvents}
            pendingApproval={pendingApproval}
            interruptRequested={interruptRequested}
          />
        </>
      : <>
          <RecentTurnsPanel turns={turns} />
          <ActivityPanel
            isRunning={isRunning}
            workingFrame={workingFrame}
            elapsedSeconds={elapsedSeconds}
            liveEvents={liveEvents}
            pendingApproval={pendingApproval}
            interruptRequested={interruptRequested}
          />
          <ConversationPanel messages={messages} />
        </>}

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={pendingApproval ? 'yellow' : isRunning ? 'yellow' : 'cyan'}
        paddingX={1}
        paddingY={0}
      >
        <Text bold color={pendingApproval ? 'yellow' : undefined}>
          {pendingApproval ? 'Approval Required' : isRunning ? `Working${workingFrames[workingFrame]}` : 'Prompt'}
        </Text>
        {pendingApproval ?
          <ApprovalComposer pendingApproval={pendingApproval} approvalChoice={approvalChoice} />
        : <>
            {shouldShowSlashHints(draft) ?
              <SlashHintPanel draft={draft} activeSessionId={activeSession?.id ?? ''} sessions={sessions} />
            : shouldShowCommandHint(draft) ?
              <CommandHintPanel draft={draft} />
            : null}
            <Box>
              <Text color="cyan">{'>'} </Text>
              <Box flexGrow={1}>
                <PromptInput
                  value={draft}
                  isDisabled={isRunning}
                  placeholder="Ask Heddle about this project"
                  onChange={setDraft}
                  onSubmit={(value) => {
                    setDraft('');
                    void submitPrompt(value);
                  }}
                />
              </Box>
            </Box>
            <Box justifyContent="space-between">
              <Text dimColor>{draft ? `${draft.length} chars` : 'Enter to send'}</Text>
              <Text dimColor>{isRunning ? `${elapsedSeconds}s elapsed` : 'Enter to send'}</Text>
            </Box>
          </>}
      </Box>
    </Box>
  );
}

export function startChatCli(options: ChatCliOptions = {}) {
  const runtime = resolveChatRuntimeConfig(options);
  render(<App runtime={runtime} />);
}
