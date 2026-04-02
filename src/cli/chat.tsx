import React, { useMemo, useRef, useState } from 'react';
import { Box, Text, render } from 'ink';
import {
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
import { normalizeSessionTitle } from './chat-format.js';
import { executeAgentTurn, executeDirectShellCommand as runDirectShellAction } from './chat-actions.js';
import { useChatRunState } from './useChatRunState.js';
import { useChatSessions } from './useChatSessions.js';
import { submitChatPrompt } from './chat-submit.js';
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
import { isGenericSessionName } from './chat-storage.js';
import { resolveChatRuntimeConfig } from './chat-runtime.js';
import type { ChatCliOptions, ChatRuntimeConfig } from './chat-runtime.js';

const SESSION_TITLE_MODEL = 'gpt-5.1-codex-mini';
export type { ChatCliOptions } from './chat-runtime.js';

function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextIdRef = useRef(0);
  const [activeModel, setActiveModel] = useState(runtime.model);
  const [draft, setDraft] = useState('');
  const nextLocalId = () => `ui-${Date.now()}-${nextIdRef.current++}`;
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

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    activeSessionSummary,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    createSession,
    renameSession,
    removeSession,
  } = useChatSessions({
    sessionsFile: runtime.sessionsFile,
    apiKeyPresent: Boolean(runtime.apiKey),
  });
  const {
    status,
    setStatus,
    isRunning,
    error,
    setError,
    liveEvents,
    workingFrame,
    elapsedSeconds,
    pendingApproval,
    approvalChoice,
    interruptRequested,
    setLiveEvents,
    resetRunState,
    actionState,
    workingFrames,
  } = useChatRunState(nextLocalId);
  const messages = activeSession?.messages ?? [];
  const turns = activeSession?.turns ?? [];

  const switchSession = (id: string) => {
    setActiveSessionId(id);
    setDraft('');
    resetRunState({ abortInFlight: true });
  };

  const closeSession = (id: string) => {
    const removedActive = removeSession(id);
    if (removedActive) {
      setDraft('');
      resetRunState({ abortInFlight: true });
    }
  };

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
      state: actionState,
      updateSessionById,
      maybeAutoNameSession,
    });
  };

  const executeDirectShellCommand = async (rawCommand: string) => {
    await runDirectShellAction({
      rawCommand,
      activeSessionId,
      runtime,
      tools,
      state: actionState,
      updateActiveSession,
      maybeAutoNameSession,
    });
  };

  const submitPrompt = async (value: string) => {
    await submitChatPrompt({
      value,
      isRunning,
      activeModel,
      setActiveModel,
      sessions,
      recentSessions,
      activeSessionId,
      activeSession,
      apiKeyPresent: Boolean(runtime.apiKey),
      nextLocalId,
      setStatus,
      switchSession,
      closeSession,
      updateSessionById,
      updateActiveSession,
      createSession,
      renameSession,
      listRecentSessionsMessage,
      executeTurn,
      executeDirectShellCommand,
    });
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
