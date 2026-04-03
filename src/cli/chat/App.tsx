import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import {
  ApprovalComposer,
  CommandHintPanel,
  ConversationPanel,
  ModelPickerPanel,
  PromptInput,
  SessionPickerPanel,
  shouldShowCommandHint,
  shouldShowSlashHints,
  SlashHintPanel,
} from './components/index.js';
import { estimateOpenAiContextWindow, filterOpenAiModels } from '../../llm/openai-models.js';
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
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [sessionPickerIndex, setSessionPickerIndex] = useState(0);
  const nextLocalId = () => `ui-${Date.now()}-${nextIdRef.current++}`;
  const modelPickerQuery = getModelPickerQuery(draft);
  const modelPickerVisible = modelPickerQuery !== undefined;
  const filteredModels = modelPickerVisible ? filterOpenAiModels(modelPickerQuery) : [];
  const safeModelPickerIndex =
    filteredModels.length === 0 ? 0 : Math.min(modelPickerIndex, Math.max(0, filteredModels.length - 1));
  const highlightedModel = filteredModels[safeModelPickerIndex];

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
  const sessionPickerQuery = getSessionPickerQuery(draft);
  const sessionPickerVisible = sessionPickerQuery !== undefined;
  const filteredSessions = sessionPickerVisible ? filterSessionsForPicker(recentSessions, sessionPickerQuery) : [];
  const safeSessionPickerIndex =
    filteredSessions.length === 0 ? 0 : Math.min(sessionPickerIndex, Math.max(0, filteredSessions.length - 1));
  const highlightedSession = filteredSessions[safeSessionPickerIndex];
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
  const contextStatus = formatContextStatus(activeModel, activeSession?.context?.estimatedHistoryTokens);
  const promptStatusLine = [
    `model=${activeModel}`,
    contextStatus,
    `session=${activeSession?.id ?? activeSessionId}${activeSession?.name ? ` (${activeSession.name})` : ''}`,
  ].join(' • ');
  const activityLines = liveEvents
    .slice(-4)
    .filter((event, index, events) => events.findIndex((candidate) => candidate.text === event.text) === index)
    .map((event, index, events) => {
      if (isRunning && index === events.length - 1) {
        return `${event.text} · ${elapsedSeconds}s`;
      }

      return event.text;
    });
  const activeTurn =
    isRunning || pendingApproval || interruptRequested || error ?
      {
        title:
          pendingApproval ? activityText
          : error ? 'Recent activity before failure'
          : isRunning ? 'Recent activity'
          : activityText,
        lines:
          pendingApproval ? activityLines.filter((line) => line !== activityText)
          : activityLines,
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
    if (modelPickerVisible && highlightedModel) {
      setDraft('');
      setModelPickerIndex(0);
      await submitChatPrompt({
        value: `/model ${highlightedModel}`,
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
      return;
    }

    if (sessionPickerVisible && highlightedSession) {
      setDraft('');
      setSessionPickerIndex(0);
      await submitChatPrompt({
        value: `/session switch ${highlightedSession.id}`,
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
      return;
    }

    setModelPickerIndex(0);
    setSessionPickerIndex(0);
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
            {modelPickerVisible ?
              <ModelPickerPanel
                query={modelPickerQuery}
                models={filteredModels}
                activeModel={activeModel}
                highlightedIndex={safeModelPickerIndex}
              />
            : null}
            {sessionPickerVisible ?
              <SessionPickerPanel
                query={sessionPickerQuery}
                sessions={filteredSessions}
                activeSessionId={activeSessionId}
                highlightedIndex={safeSessionPickerIndex}
              />
            : null}
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
                  onSpecialKey={({ key }) => {
                    if (modelPickerVisible) {
                      return handlePickerKeys({
                        key,
                        itemCount: filteredModels.length,
                        resetDraft: () => setDraft(''),
                        resetIndex: () => setModelPickerIndex(0),
                        advance: () => setModelPickerIndex((current) => (current + 1) % filteredModels.length),
                        retreat: () => setModelPickerIndex((current) => (current <= 0 ? filteredModels.length - 1 : current - 1)),
                      });
                    }

                    if (sessionPickerVisible) {
                      return handlePickerKeys({
                        key,
                        itemCount: filteredSessions.length,
                        resetDraft: () => setDraft(''),
                        resetIndex: () => setSessionPickerIndex(0),
                        advance: () => setSessionPickerIndex((current) => (current + 1) % filteredSessions.length),
                        retreat: () => setSessionPickerIndex((current) => (current <= 0 ? filteredSessions.length - 1 : current - 1)),
                      });
                    }

                    return false;
                  }}
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
      <Text dimColor>{promptStatusLine}</Text>
    </Box>
  );
}

function getModelPickerQuery(draft: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith('/model set')) {
    return undefined;
  }

  const remainder = trimmedStart.slice('/model set'.length);
  return remainder.trim();
}

function getSessionPickerQuery(draft: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith('/session choose')) {
    return undefined;
  }

  const remainder = trimmedStart.slice('/session choose'.length);
  return remainder.trim();
}

function filterSessionsForPicker(
  sessions: Array<{ id: string; name: string }>,
  query: string,
): Array<{ id: string; name: string }> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return sessions;
  }

  return sessions.filter(
    (session) =>
      session.id.toLowerCase().includes(normalized) ||
      session.name.toLowerCase().includes(normalized),
  );
}

function handlePickerKeys(options: {
  key: {
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    tab?: boolean;
    escape?: boolean;
  };
  itemCount: number;
  resetDraft: () => void;
  resetIndex: () => void;
  advance: () => void;
  retreat: () => void;
}): boolean {
  if ((options.key.upArrow || options.key.leftArrow) && options.itemCount > 0) {
    options.retreat();
    return true;
  }

  if ((options.key.downArrow || options.key.rightArrow || options.key.tab) && options.itemCount > 0) {
    options.advance();
    return true;
  }

  if (options.key.escape) {
    options.resetDraft();
    options.resetIndex();
    return true;
  }

  return false;
}

function formatContextStatus(model: string, estimatedHistoryTokens?: number): string {
  if (estimatedHistoryTokens === undefined) {
    return 'context=unknown';
  }

  const contextWindow = estimateOpenAiContextWindow(model);
  if (!contextWindow) {
    return `context≈${formatTokenCount(estimatedHistoryTokens)} used`;
  }

  const remainingTokens = Math.max(contextWindow - estimatedHistoryTokens, 0);
  const remainingPercent = Math.max(Math.round((remainingTokens / contextWindow) * 100), 0);
  return `context≈${remainingPercent}% left`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return `${value}`;
}
