import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import {
  ApprovalComposer,
  CommandHintPanel,
  ConversationPanel,
  PromptInput,
  shouldShowCommandHint,
  shouldShowSlashHints,
  SlashHintPanel,
} from './components/index.js';
import { useApprovalFlow } from './hooks/useApprovalFlow.js';
import { useAgentRun } from './hooks/useAgentRun.js';
import { useChatSessions } from './hooks/useChatSessions.js';
import { submitChatPrompt } from './submit.js';
import { currentActivityText } from './utils/format.js';
import type { ChatRuntimeConfig } from './utils/runtime.js';

const SESSION_TITLE_MODEL = 'gpt-5.1-codex-mini';

export function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextIdRef = useRef(0);
  const [activeModel, setActiveModel] = useState(runtime.model);
  const [draft, setDraft] = useState('');
  const nextLocalId = () => `ui-${Date.now()}-${nextIdRef.current++}`;

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
  } = useApprovalFlow(nextLocalId);
  const messages = activeSession?.messages ?? [];
  const activityText = currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested);
  const activityLines = (isRunning ? liveEvents.slice(-3) : liveEvents.slice(-1))
    .filter((event, index, events) => {
      if (event.text === activityText) {
        return false;
      }

      return events.findIndex((candidate) => candidate.text === event.text) === index;
    })
    .map((event) => event.text);
  const activeTurn =
    isRunning || pendingApproval || interruptRequested || error ?
      {
        title: activityText,
        lines: activityLines,
        error,
      }
    : undefined;
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

  const { executeTurn, executeDirectShellCommand } = useAgentRun({
    runtime,
    activeModel,
    sessionTitleModel: SESSION_TITLE_MODEL,
    activeSessionId,
    sessions,
    state: actionState,
    updateSessionById,
    updateActiveSession,
  });

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
        <Text bold>
          Heddle
          <Text dimColor>
            {` • ${activeSession?.name ?? 'unknown'} • model=${activeModel} • steps=${runtime.maxSteps}`}
          </Text>
        </Text>
        <Text color={error ? 'red' : isRunning ? 'yellow' : 'green'}>
          status={pendingApproval ? 'awaiting approval' : interruptRequested ? 'interrupt requested' : isRunning ? 'running' : status}
        </Text>
        <Text dimColor>
          {pendingApproval ? '←/→ choose • Enter confirms • A remembers for this project • Esc denies • Ctrl+C exits'
          : isRunning ? 'Esc requests stop after the current step • Ctrl+C exits'
          : 'Enter sends • /help shows commands • !command runs shell • Ctrl+C exits'}
        </Text>
      </Box>

      <ConversationPanel messages={messages} activeTurn={activeTurn} />

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
              <Text dimColor>{isRunning ? `${elapsedSeconds}s elapsed` : ''}</Text>
            </Box>
          </>}
      </Box>
    </Box>
  );
}
