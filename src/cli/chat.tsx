import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { ChatMessage, ToolCall, ToolDefinition, TraceEvent } from '../index.js';
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  createOpenAiAdapter,
  createToolRegistry,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  reportStateTool,
  createRunShellInspectTool,
  createRunShellMutateTool,
  createLogger,
} from '../index.js';
import { DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES, runShellCommand } from '../tools/run-shell.js';

type TurnSummary = {
  id: string;
  prompt: string;
  outcome: string;
  summary: string;
  steps: number;
  traceFile: string;
  events: string[];
};

type ConversationLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type LiveEvent = {
  id: string;
  text: string;
};

type ChatSession = {
  id: string;
  name: string;
  history: ChatMessage[];
  messages: ConversationLine[];
  turns: TurnSummary[];
  createdAt: string;
  updatedAt: string;
  lastContinuePrompt?: string;
};

type PendingApproval = {
  call: ToolCall;
  tool: ToolDefinition;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
};

type ApprovalChoice = 'approve' | 'deny';
type LocalCommandResult =
  | { handled: false }
  | { handled: true; kind: 'message'; message: string }
  | { handled: true; kind: 'continue'; sessionId?: string; message?: string };

const knownModels = ['gpt-5.1-codex-mini', 'gpt-5.1-codex'];
const workingFrames = ['.', '..', '...'];
const MAX_VISIBLE_INPUT_CHARS = 96;
const SESSION_TITLE_MODEL = 'gpt-5.1-codex-mini';
const MAX_SHELL_OUTPUT_CHARS = 1400;
export type ChatCliOptions = {
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  workspaceRoot?: string;
};

type ChatRuntimeConfig = {
  model: string;
  maxSteps: number;
  apiKey?: string;
  logFile: string;
  sessionsFile: string;
  workspaceRoot: string;
};

function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextIdRef = useRef(0);
  const nextSessionNumberRef = useRef(2);
  const initialSessionsRef = useRef<ChatSession[] | undefined>(undefined);
  if (!initialSessionsRef.current) {
    initialSessionsRef.current = loadChatSessions(runtime.sessionsFile, Boolean(runtime.apiKey));
  }
  const [activeModel, setActiveModel] = useState(runtime.model);
  const llm = useMemo(() => createOpenAiAdapter({ model: activeModel, apiKey: runtime.apiKey }), [activeModel, runtime.apiKey]);
  const titleLlm = useMemo(
    () => createOpenAiAdapter({ model: SESSION_TITLE_MODEL, apiKey: runtime.apiKey }),
    [runtime.apiKey],
  );
  const tools = useMemo(
    () => [
      listFilesTool,
      readFileTool,
      searchFilesTool,
      reportStateTool,
      createRunShellInspectTool(),
      createRunShellMutateTool(),
    ],
    [],
  );
  const toolRegistry = useMemo(() => createToolRegistry(tools), [tools]);
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
  const history = activeSession?.history ?? [];
  const messages = activeSession?.messages ?? [];
  const turns = activeSession?.turns ?? [];
  const continuePrompt = activeSession?.lastContinuePrompt;

  const updateActiveSession = (updater: (session: ChatSession) => ChatSession) => {
    updateSessionById(activeSessionId, updater);
  };

  const updateSessionById = (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ?
          touchSession(updater(session))
        : session),
    );
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
    if (sessions.length === 0) {
      const fallback = createChatSession({
        id: 'session-1',
        name: 'Session 1',
        apiKeyPresent: Boolean(runtime.apiKey),
      });
      setSessions([fallback]);
      setActiveSessionId(fallback.id);
    }
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
    updateActiveSession((session) => ({
      ...session,
      name,
    }));
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
    () =>
      [...sessions]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 8),
    [sessions],
  );

  const activeSessionSummary = activeSession ? summarizeSession(activeSession) : undefined;
  const listRecentSessionsMessage = recentSessions.length > 0 ?
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
      } catch (error) {
        logger.debug(
          { error: error instanceof Error ? error.message : String(error), sessionId },
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
      const nextUserMessage: ConversationLine = { id: nextLocalId(), role: 'user', text: displayText };
      updateSessionById(sessionIdOverride, (session) => ({
        ...session,
        messages: [...session.messages, nextUserMessage],
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

      updateSessionById(sessionIdOverride, (session) => ({
        ...session,
        history: result.transcript,
        messages: buildConversationMessages(result.transcript),
      }));

      const traceFile = saveTrace(result.trace);
      const nextTurn: TurnSummary = {
        id: nextLocalId(),
        prompt,
        outcome: result.outcome,
        summary: result.summary,
        steps: countAssistantSteps(result.trace),
        traceFile,
        events: summarizeTrace(result.trace),
      };
      updateSessionById(sessionIdOverride, (session) => ({
        ...session,
        turns: [...session.turns, nextTurn].slice(-8),
      }));
      const assistantText =
        buildConversationMessages(result.transcript).filter((message) => message.role === 'assistant').at(-1)?.text ??
        result.summary;
      maybeAutoNameSession(sessionIdOverride, prompt, assistantText);
      if (result.outcome === 'error') {
        setError(result.summary);
      }
      setStatus(result.outcome === 'done' ? 'Idle' : `Stopped: ${result.outcome}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus('Error');
      updateSessionById(sessionIdOverride, (session) => ({
        ...session,
        messages: [
          ...session.messages,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setStatus('Error');
      updateActiveSession((session) => ({
        ...session,
        messages: [...session.messages, { id: nextLocalId(), role: 'assistant', text: `Direct shell execution failed:\n${message}` }],
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

      const targetSession = commandResult.sessionId ? sessions.find((session) => session.id === commandResult.sessionId) : activeSession;
      const targetHistory = targetSession?.history ?? [];
      const targetContinuePrompt = targetSession?.lastContinuePrompt;

      if (commandResult.message) {
        const targetId = commandResult.sessionId ?? activeSessionId;
        updateSessionById(targetId, (session) => ({
          ...session,
          messages: [
            ...session.messages,
            { id: nextLocalId(), role: 'assistant', text: commandResult.message as string },
          ],
        }));
      }

      if (!targetHistory.length || !targetContinuePrompt) {
        updateActiveSession((session) => ({
          ...session,
          messages: [
            ...session.messages,
            { id: nextLocalId(), role: 'assistant', text: 'There is no interrupted or prior run to continue yet.' },
          ],
        }));
        setStatus('Idle');
        return;
      }

      if (!commandResult.message) {
        updateActiveSession((session) => ({
          ...session,
          messages: [...session.messages, { id: nextLocalId(), role: 'assistant', text: 'Continuing from the current transcript.' }],
        }));
      }
      await executeTurn('Continue from where you left off.', 'Continue', commandResult.sessionId ?? activeSessionId);
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

      {isRunning ? (
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
      ) : (
        <>
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
        </>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor={pendingApproval ? 'yellow' : isRunning ? 'yellow' : 'cyan'} paddingX={1} paddingY={0}>
        <Text bold color={pendingApproval ? 'yellow' : undefined}>
          {pendingApproval ? 'Approval Required' : isRunning ? `Working${workingFrames[workingFrame]}` : 'Prompt'}
        </Text>
        {pendingApproval ?
          <ApprovalComposer pendingApproval={pendingApproval} approvalChoice={approvalChoice} />
        : (
          <>
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
          </>
        )}
      </Box>
    </Box>
  );
}

type ConversationPanelProps = {
  messages: ConversationLine[];
};

function ConversationPanel({ messages }: ConversationPanelProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {messages.slice(-8).map((message) => (
        <Box key={message.id} borderStyle="round" borderColor={message.role === 'user' ? 'cyan' : 'gray'} paddingX={1} marginBottom={1}>
          <Text color={message.role === 'user' ? 'cyan' : 'white'}>
            {message.role === 'user' ? 'You' : 'Heddle'}: {message.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

type RecentTurnsPanelProps = {
  turns: TurnSummary[];
};

function RecentTurnsPanel({ turns }: RecentTurnsPanelProps) {
  const latestTurn = turns[turns.length - 1];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Recent Turns</Text>
      {!latestTurn ?
        <Text dimColor>No completed turns yet.</Text>
      : (
        <Box flexDirection="column">
          <Text color="magenta">{truncate(latestTurn.prompt, 120)}</Text>
          <Text dimColor>
            outcome={latestTurn.outcome} steps={latestTurn.steps} trace={latestTurn.traceFile}
          </Text>
          {latestTurn.outcome !== 'done' ? <Text color="red">{latestTurn.summary}</Text> : null}
          <Text dimColor>
            {latestTurn.events.slice(0, 4).join(' • ')}
          </Text>
        </Box>
      )
      }
    </Box>
  );
}

type ActivityPanelProps = {
  isRunning: boolean;
  workingFrame: number;
  elapsedSeconds: number;
  liveEvents: LiveEvent[];
  pendingApproval?: PendingApproval;
  interruptRequested: boolean;
};

function ActivityPanel({ isRunning, workingFrame, elapsedSeconds, liveEvents, pendingApproval, interruptRequested }: ActivityPanelProps) {
  const visibleEvents = isRunning ? liveEvents.slice(-3) : liveEvents.slice(-1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Current Activity</Text>
      <Text color={pendingApproval ? 'yellow' : interruptRequested ? 'yellow' : isRunning ? 'yellow' : 'gray'}>
        {currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested)}
      </Text>
      {visibleEvents.map((event) => (
        <Box key={event.id}>
          <Text dimColor>{event.text}</Text>
        </Box>
      ))}
    </Box>
  );
}

type ApprovalComposerProps = {
  pendingApproval: PendingApproval;
  approvalChoice: ApprovalChoice;
};

function ApprovalComposer({ pendingApproval, approvalChoice }: ApprovalComposerProps) {
  return (
    <>
      <Text color="white">{formatApprovalPrompt(pendingApproval)}</Text>
      <Text dimColor>{formatApprovalHint(pendingApproval)}</Text>
      <ApprovalSelector choice={approvalChoice} />
      <Box justifyContent="space-between">
        <Text dimColor>Use ←/→ then Enter</Text>
        <Text dimColor>Input paused during approval</Text>
      </Box>
    </>
  );
}

type ApprovalSelectorProps = {
  choice: ApprovalChoice;
};

function ApprovalSelector({ choice }: ApprovalSelectorProps) {
  return (
    <Box marginBottom={0}>
      <Text color={choice === 'approve' ? 'green' : 'gray'}>
        {choice === 'approve' ? '◉ Approve' : '○ Approve'}
      </Text>
      <Text dimColor>   </Text>
      <Text color={choice === 'deny' ? 'red' : 'gray'}>
        {choice === 'deny' ? '◉ Deny' : '○ Deny'}
      </Text>
    </Box>
  );
}

export function startChatCli(options: ChatCliOptions = {}) {
  const runtime = resolveChatRuntimeConfig(options);
  render(<App runtime={runtime} />);
}

function buildConversationMessages(history: ChatMessage[]): ConversationLine[] {
  return history.flatMap((message, index) => {
    if (message.role === 'user' || message.role === 'assistant') {
      if (!message.content.trim()) {
        return [];
      }

      return [{ id: `${message.role}-${index}-${message.content}`, role: message.role, text: message.content }];
    }

    return [];
  });
}

function saveTrace(trace: TraceEvent[]): string {
  const traceDir = join(process.cwd(), 'local', 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));
  return traceFile;
}

function summarizeTrace(trace: TraceEvent[]): string[] {
  return trace.flatMap((event) => {
    switch (event.type) {
      case 'assistant.turn':
        return [
          ...(event.diagnostics?.rationale ? [`reasoning: ${truncate(event.diagnostics.rationale, 140)}`] : []),
          event.requestedTools ?
            `assistant requested ${event.toolCalls?.map((call) => summarizeToolCall(call.tool, call.input)).join(', ')}`
          : 'assistant answered',
        ];
      case 'tool.approval_requested':
        return [`approval requested for ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.approval_resolved':
        return [
          `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}`,
        ];
      case 'tool.call':
        return [`tool call ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.result':
        return [
          `tool result ${summarizeToolResult(event.tool, extractShellCommand(event.result.output))}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`,
        ];
      case 'run.finished':
        return [`run finished: ${event.outcome}`];
      default:
        return [];
    }
  });
}

function countAssistantSteps(trace: TraceEvent[]): number {
  return trace.filter((event) => event.type === 'assistant.turn').length;
}

function toLiveEvent(event: TraceEvent): string | undefined {
  switch (event.type) {
    case 'run.started':
      return `thinking`;
    case 'assistant.turn':
      if (event.diagnostics?.rationale) {
        return `reasoning: ${truncate(event.diagnostics.rationale, 140)}`;
      }
      if (event.requestedTools) {
        return undefined;
      }
      return `answer ready`;
    case 'tool.approval_requested':
      return `approval needed for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.approval_resolved':
      return `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.call':
      return `running ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.result':
      return `${summarizeToolResult(event.tool, extractShellCommand(event.result.output))} ${event.result.ok ? 'completed' : `failed: ${event.result.error ?? 'error'}`}`;
    case 'run.finished':
      return event.outcome === 'done' ? undefined : `stopped: ${event.outcome}`;
    default:
      return undefined;
  }
}

function currentActivityText(
  liveEvents: LiveEvent[],
  isRunning: boolean,
  elapsedSeconds: number,
  pendingApproval?: PendingApproval,
  interruptRequested?: boolean,
): string {
  if (pendingApproval) {
    return formatApprovalPrompt(pendingApproval);
  }

  if (interruptRequested) {
    return 'interrupt requested; waiting for the current step to finish';
  }

  const current = liveEvents[liveEvents.length - 1]?.text;

  if (isRunning) {
    return current ? `${current} · ${elapsedSeconds}s` : 'waiting for first agent event...';
  }

  return current ?? 'idle';
}

function formatApprovalPrompt(pendingApproval: PendingApproval): string {
  const command = extractShellCommand(pendingApproval.call.input);
  if (command) {
    return `Allow mutation command: ${command}`;
  }

  return `Allow ${pendingApproval.call.tool}`;
}

function formatApprovalHint(pendingApproval: PendingApproval): string {
  return `Tool: ${pendingApproval.call.tool}`;
}

function summarizeToolCall(tool: string, input: unknown): string {
  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${shellCommand})`;
  }

  return tool;
}

function summarizeToolResult(tool: string, command: string | undefined): string {
  if (command) {
    return `${tool} (${command})`;
  }

  return tool;
}

function extractShellCommand(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

type LocalCommandArgs = {
  prompt: string;
  activeModel: string;
  setActiveModel: (model: string) => void;
  sessions: ChatSession[];
  recentSessions: ChatSession[];
  activeSessionId: string;
  switchSession: (id: string) => void;
  createSession: (name?: string) => ChatSession;
  renameSession: (name: string) => void;
  removeSession: (id: string) => void;
  clearConversation: () => void;
  listRecentSessionsMessage: string[];
};

function runLocalCommand(args: LocalCommandArgs): LocalCommandResult {
  const trimmed = args.prompt.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  if (trimmed === '/help') {
    return {
      handled: true,
      kind: 'message',
      message: [
        'Local commands',
        '',
        '/model',
        'Show the active model.',
        '',
        '/model <name>',
        'Switch the current model.',
        '',
        '/models',
        'List common model choices.',
        '',
        '/continue',
        'Resume the current session from its last interrupted or prior run.',
        '',
        '/clear',
        'Reset the current session transcript.',
        '',
        '/session list',
        'List recent saved sessions.',
        '',
        '/session new [name]',
        'Create and switch to a new session.',
        '',
        '/session switch <id>',
        'Switch to another saved session.',
        '',
        '/session continue <id>',
        'Switch to another saved session and immediately resume it.',
        '',
        '/session rename <name>',
        'Rename the current session.',
        '',
        '/session close <id>',
        'Remove a saved session.',
        '',
        '!<command>',
        'Run a shell command directly in chat using the current inspect or execute policy.',
        '',
        '/help',
        'Show this message.',
      ].join('\n'),
    };
  }

  if (trimmed === '/models') {
    return {
      handled: true,
      kind: 'message',
      message: `Common model choices: ${knownModels.join(', ')}`,
    };
  }

  if (trimmed === '/model') {
    return {
      handled: true,
      kind: 'message',
      message: `Current model: ${args.activeModel}`,
    };
  }

  if (trimmed.startsWith('/model ')) {
    const nextModel = trimmed.slice('/model '.length).trim();
    if (!nextModel) {
      return {
        handled: true,
        kind: 'message',
        message: 'Usage: /model <name>',
      };
    }

    args.setActiveModel(nextModel);
    return {
      handled: true,
      kind: 'message',
      message:
        knownModels.includes(nextModel) ?
          `Switched model to ${nextModel}`
        : `Switched model to ${nextModel}. This name is not in Heddle's common shortlist, so the next API call will fail if the provider does not recognize it.`,
    };
  }

  if (trimmed === '/clear') {
    args.clearConversation();
    return {
      handled: true,
      kind: 'message',
      message: 'Cleared the current chat transcript.',
    };
  }

  if (trimmed === '/continue') {
    return {
      handled: true,
      kind: 'continue',
    };
  }

  if (trimmed === '/session list') {
    const lines = args.sessions.map((session) =>
      `${session.id === args.activeSessionId ? '*' : '-'} ${session.id} (${session.name}) • ${summarizeSession(session)}`,
    );
    return {
      handled: true,
      kind: 'message',
      message: lines.length > 0 ? args.listRecentSessionsMessage.join('\n') : 'No sessions available.',
    };
  }

  if (trimmed.startsWith('/session new')) {
    const maybeName = trimmed.slice('/session new'.length).trim();
    const session = args.createSession(maybeName || undefined);
    return {
      handled: true,
      kind: 'message',
      message: `Created and switched to ${session.id} (${session.name}).`,
    };
  }

  if (trimmed.startsWith('/session switch ')) {
    const id = trimmed.slice('/session switch '.length).trim();
    const session = args.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return {
        handled: true,
        kind: 'message',
        message: `Unknown session: ${id}. Use /session list to inspect available sessions.`,
      };
    }
    args.switchSession(id);
    return {
      handled: true,
      kind: 'message',
      message: `Switched to ${session.id} (${session.name}).\n${summarizeSession(session)}`,
    };
  }

  if (trimmed.startsWith('/session continue ')) {
    const id = trimmed.slice('/session continue '.length).trim();
    const session = args.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return {
        handled: true,
        kind: 'message',
        message: `Unknown session: ${id}.\nUse /session list to inspect available sessions.`,
      };
    }
    return {
      handled: true,
      kind: 'continue',
      sessionId: id,
      message: `Switched to ${session.id} (${session.name}).\nContinuing from that session transcript.`,
    };
  }

  if (trimmed.startsWith('/session rename ')) {
    const name = trimmed.slice('/session rename '.length).trim();
    if (!name) {
      return { handled: true, kind: 'message', message: 'Usage: /session rename <name>' };
    }
    args.renameSession(name);
    return {
      handled: true,
      kind: 'message',
      message: `Renamed current session to ${name}.`,
    };
  }

  if (trimmed.startsWith('/session close ')) {
    const id = trimmed.slice('/session close '.length).trim();
    const session = args.sessions.find((candidate) => candidate.id === id);
    if (!session) {
      return {
        handled: true,
        kind: 'message',
        message: `Unknown session: ${id}.\nUse /session list to inspect available sessions.`,
      };
    }
    args.removeSession(id);
    return {
      handled: true,
      kind: 'message',
      message: `Closed ${session.id} (${session.name}).`,
    };
  }

  return {
    handled: true,
    kind: 'message',
    message: `Unknown command: ${trimmed}. Use /help for available commands.`,
  };
}

type PromptInputProps = {
  value: string;
  isDisabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
};

function PromptInput({ value, isDisabled, placeholder, onChange, onSubmit }: PromptInputProps) {
  const [cursor, setCursor] = useState(value.length);

  useInput((input, key) => {
    if (isDisabled) {
      return;
    }

    if (key.return) {
      onSubmit(value);
      setCursor(0);
      return;
    }

    if ((key.meta && key.backspace) || (key.ctrl && input === 'u')) {
      onChange(value.slice(cursor));
      setCursor(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) {
        return;
      }

      onChange(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(cursor - 1);
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }

    if (key.home) {
      setCursor(0);
      return;
    }

    if (key.end) {
      setCursor(value.length);
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }

    if (!input) {
      return;
    }

    const nextInput = normalizePastedInput(input);
    onChange(value.slice(0, cursor) + nextInput + value.slice(cursor));
    setCursor(cursor + nextInput.length);
  }, { isActive: !isDisabled });

  if (!value) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return <Text>{buildPromptViewport(value, cursor)}</Text>;
}

function normalizePastedInput(input: string): string {
  return input.replace(/\r?\n+/g, ' ');
}

function createInitialMessages(apiKeyPresent: boolean): ConversationLine[] {
  return [
    {
      id: 'intro',
      role: 'assistant',
      text:
        'Heddle conversational mode.\n\nAsk a question about this workspace.\nEach turn runs the current agent loop and carries the transcript into the next turn.\nUse !<command> to run a shell command directly in chat.',
    },
    ...(!apiKeyPresent ?
      [{
        id: 'missing-key',
        role: 'assistant' as const,
        text:
          'No OpenAI API key detected. Set OPENAI_API_KEY or PERSONAL_OPENAI_API_KEY, or use yarn chat:dev if your shell exposes PERSONAL_OPENAI_API_KEY.',
      }]
    : []),
  ];
}

function createChatSession(options: {
  id: string;
  name: string;
  apiKeyPresent: boolean;
}): ChatSession {
  const now = new Date().toISOString();
  return {
    id: options.id,
    name: options.name,
    history: [],
    messages: createInitialMessages(options.apiKeyPresent),
    turns: [],
    createdAt: now,
    updatedAt: now,
    lastContinuePrompt: undefined,
  };
}

type SlashHintPanelProps = {
  draft: string;
  activeSessionId: string;
  sessions: ChatSession[];
};

function SlashHintPanel({ draft, activeSessionId, sessions }: SlashHintPanelProps) {
  const hints = getSlashHints(draft, activeSessionId, sessions).slice(0, 10);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Slash commands</Text>
      {hints.map((hint) => (
        <Text key={hint.command} dimColor>
          {hint.command} {hint.description}
        </Text>
      ))}
    </Box>
  );
}

function shouldShowSlashHints(draft: string): boolean {
  return draft.trimStart().startsWith('/');
}

function shouldShowCommandHint(draft: string): boolean {
  return draft.trimStart().startsWith('!');
}

type CommandHintPanelProps = {
  draft: string;
};

function CommandHintPanel({ draft }: CommandHintPanelProps) {
  const command = draft.trim().slice(1).trim();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Direct shell</Text>
      <Text dimColor>
        {command ?
          `Run ${command} directly in chat. Read-oriented commands stay in inspect mode; other commands fall back to approval-gated execution.`
        : 'Start with ! to run a shell command directly in chat.'}
      </Text>
    </Box>
  );
}

function getSlashHints(
  draft: string,
  activeSessionId: string,
  sessions: ChatSession[],
): Array<{ command: string; description: string }> {
  const base = [
    { command: '/help', description: 'show available local commands' },
    { command: '/model', description: 'show the active model' },
    { command: '/model <name>', description: 'switch the current model' },
    { command: '/models', description: 'list common model choices' },
    { command: '/continue', description: 'resume from the current transcript' },
    { command: '/clear', description: 'reset the current session transcript' },
    { command: '/session list', description: 'list local chat sessions' },
    { command: '/session new [name]', description: 'create and switch to a new session' },
    { command: '/session switch <id>', description: 'switch to another session' },
    { command: '/session continue <id>', description: 'switch to a session and resume it' },
    { command: '/session rename <name>', description: 'rename the current session' },
    { command: '/session close <id>', description: 'remove a saved session' },
  ];

  const trimmed = draft.trim();
  const filtered = base.filter((hint) => hint.command.startsWith(trimmed) || trimmed === '/');
  if (trimmed.startsWith('/session switch ')) {
    const sessionHints = sessions.map((session) => ({
      command: `/session switch ${session.id}`,
      description: `${session.id === activeSessionId ? '(current) ' : ''}${session.name}`,
    }));
    return sessionHints.filter((hint) => hint.command.startsWith(trimmed));
  }

  return filtered.length > 0 ? filtered : base;
}

function touchSession(session: ChatSession): ChatSession {
  return { ...session, updatedAt: new Date().toISOString() };
}

function summarizeSession(session: ChatSession): string {
  const latestTurn = session.turns[session.turns.length - 1];
  const latestPrompt = latestTurn ? truncate(latestTurn.prompt, 44) : 'no turns yet';
  return `${session.turns.length} turns • ${latestPrompt}`;
}

function resolveChatRuntimeConfig(options: ChatCliOptions): ChatRuntimeConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const sessionId = `chat-${Date.now()}`;
  return {
    model: options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    maxSteps: options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY,
    workspaceRoot,
    logFile: join(workspaceRoot, 'local', 'logs', `${sessionId}.log`),
    sessionsFile: join(workspaceRoot, 'local', 'chat-sessions.json'),
  };
}

function loadChatSessions(sessionsPath: string, apiKeyPresent: boolean): ChatSession[] {
  try {
    if (!existsSync(sessionsPath)) {
      return [
        createChatSession({
          id: 'session-1',
          name: 'Session 1',
          apiKeyPresent,
        }),
      ];
    }

    const raw = readFileSync(sessionsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Expected session array');
    }

    const sessions = parsed.flatMap((value) => parseSavedSession(value, apiKeyPresent));
    if (sessions.length > 0) {
      return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
  } catch (error) {
    process.stderr.write(
      `Failed to load chat sessions from ${sessionsPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return [
    createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent,
    }),
  ];
}

function saveChatSessions(sessionsPath: string, sessions: ChatSession[]) {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function parseSavedSession(value: unknown, apiKeyPresent: boolean): ChatSession[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<ChatSession>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return [];
  }

  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

  return [{
    id: candidate.id,
    name: candidate.name,
    history: Array.isArray(candidate.history) ? candidate.history : [],
    messages:
      Array.isArray(candidate.messages) && candidate.messages.length > 0 ?
        candidate.messages.filter(isConversationLine)
      : createInitialMessages(apiKeyPresent),
    turns: Array.isArray(candidate.turns) ? candidate.turns.filter(isTurnSummary) : [],
    createdAt,
    updatedAt,
    lastContinuePrompt: typeof candidate.lastContinuePrompt === 'string' ? candidate.lastContinuePrompt : undefined,
  }];
}

function isConversationLine(value: unknown): value is ConversationLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ConversationLine>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.text === 'string'
  );
}

function isTurnSummary(value: unknown): value is TurnSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<TurnSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.outcome === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.steps === 'number' &&
    typeof candidate.traceFile === 'string' &&
    Array.isArray(candidate.events) &&
    candidate.events.every((event) => typeof event === 'string')
  );
}

function buildPromptViewport(value: string, cursor: number): string {
  const withCursor = `${value.slice(0, cursor)}|${value.slice(cursor)}`;

  if (withCursor.length <= MAX_VISIBLE_INPUT_CHARS) {
    return withCursor;
  }

  const targetCursor = cursor + 1;
  const half = Math.floor(MAX_VISIBLE_INPUT_CHARS / 2);
  let start = Math.max(0, targetCursor - half);
  let end = Math.min(withCursor.length, start + MAX_VISIBLE_INPUT_CHARS);

  if (end - start < MAX_VISIBLE_INPUT_CHARS) {
    start = Math.max(0, end - MAX_VISIBLE_INPUT_CHARS);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < withCursor.length ? '…' : '';
  const slice = withCursor.slice(start, end);
  return `${prefix}${slice}${suffix}`;
}

function shouldFallbackToMutate(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  return error.includes('run_shell_inspect policy');
}

function formatDirectShellResponse(toolName: string, command: string, result: import('../index.js').ToolResult): string {
  const lines = [
    `Direct shell result`,
    '',
    `Command: ${command}`,
    `Tool: ${toolName}`,
  ];

  const output = result.output;
  const policy = extractPolicySummary(output);
  if (policy) {
    lines.push(`Policy: ${policy}`);
  }

  if (result.ok) {
    const stdout = extractTextOutput(output, 'stdout');
    const stderr = extractTextOutput(output, 'stderr');
    lines.push('Outcome: success');
    if (stdout) {
      lines.push('', 'stdout:', truncate(stdout, MAX_SHELL_OUTPUT_CHARS));
    }
    if (stderr) {
      lines.push('', 'stderr:', truncate(stderr, MAX_SHELL_OUTPUT_CHARS));
    }
    if (!stdout && !stderr) {
      lines.push('', 'No stdout or stderr output.');
    }
    return lines.join('\n');
  }

  lines.push(`Outcome: failed`);
  if (result.error) {
    lines.push('', `Error: ${result.error}`);
  }
  const stdout = extractTextOutput(output, 'stdout');
  const stderr = extractTextOutput(output, 'stderr');
  if (stdout) {
    lines.push('', 'stdout:', truncate(stdout, MAX_SHELL_OUTPUT_CHARS));
  }
  if (stderr) {
    lines.push('', 'stderr:', truncate(stderr, MAX_SHELL_OUTPUT_CHARS));
  }
  return lines.join('\n');
}

function extractTextOutput(value: unknown, field: 'stdout' | 'stderr'): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function extractPolicySummary(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const policy = (value as { policy?: unknown }).policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return undefined;
  }

  const candidate = policy as Record<string, unknown>;
  const scope = typeof candidate.scope === 'string' ? candidate.scope : undefined;
  const risk = typeof candidate.risk === 'string' ? candidate.risk : undefined;
  const reason = typeof candidate.reason === 'string' ? candidate.reason : undefined;
  const parts = [scope, risk, reason].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function isGenericSessionName(name: string): boolean {
  return /^Session \d+$/.test(name.trim());
}

function normalizeSessionTitle(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return undefined;
  }

  return truncate(normalized, 48);
}

function appendDirectShellHistory(
  history: ChatMessage[],
  shellDisplay: string,
  toolName: string,
  result: import('../index.js').ToolResult,
): ChatMessage[] {
  const summary = buildDirectShellHistorySummary(toolName, result);
  const userMessage: ChatMessage = { role: 'user', content: shellDisplay };
  const assistantMessage: ChatMessage = { role: 'assistant', content: summary };
  return [
    ...history,
    userMessage,
    assistantMessage,
  ].slice(-60);
}

function buildDirectShellHistorySummary(
  toolName: string,
  result: import('../index.js').ToolResult,
): string {
  const lines = [`Direct shell command via ${toolName}.`];
  const policy = extractPolicySummary(result.output);
  if (policy) {
    lines.push(`Policy: ${policy}`);
  }
  lines.push(`Outcome: ${result.ok ? 'success' : 'failure'}`);
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }

  const stdout = extractTextOutput(result.output, 'stdout');
  const stderr = extractTextOutput(result.output, 'stderr');
  if (stdout) {
    lines.push(`stdout:\n${truncate(stdout, 1200)}`);
  }
  if (stderr) {
    lines.push(`stderr:\n${truncate(stderr, 800)}`);
  }

  return lines.join('\n\n');
}
