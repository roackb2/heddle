import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ConversationLine } from './state/types.js';
import { Box, Text } from 'ink';
import {
  ApprovalComposer,
  CommandHintPanel,
  ConversationPanel,
  FileMentionPickerPanel,
  ModelPickerPanel,
  PromptInput,
  SessionPickerPanel,
  shouldShowCommandHint,
  shouldShowSlashHints,
  SlashHintPanel,
} from './components/index.js';
import { estimateBuiltInContextWindow, filterBuiltInModels } from '../../llm/openai-models.js';
import { useApprovalFlow } from './hooks/useApprovalFlow.js';
import { useAgentRun } from './hooks/useAgentRun.js';
import { useChatSessions } from './hooks/useChatSessions.js';
import { submitChatPrompt } from './submit.js';
import { currentActivityText } from './utils/format.js';
import { buildPromptWithFileMentions, filterMentionableFiles, getMentionQuery, insertMentionSelection, listMentionableFiles } from './utils/file-mentions.js';
import type { ChatRuntimeConfig } from './utils/runtime.js';

const SESSION_TITLE_MODEL = 'gpt-5.1-codex-mini';

export function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextIdRef = useRef(0);
  const [activeModel, setActiveModel] = useState(runtime.model);
  const [draft, setDraft] = useState('');
  const [draftCursor, setDraftCursor] = useState(0);
  const [pendingSubmittedPrompt, setPendingSubmittedPrompt] = useState<string | undefined>();
  const [modelPickerIndex, setModelPickerIndex] = useState(0);
  const [sessionPickerIndex, setSessionPickerIndex] = useState(0);
  const [fileMentionPickerIndex, setFileMentionPickerIndex] = useState(0);
  const nextLocalId = () => `ui-${Date.now()}-${nextIdRef.current++}`;
  const mentionableFiles = useState(() => listMentionableFiles(runtime.workspaceRoot, runtime.searchIgnoreDirs))[0];
  const mentionQuery = getMentionQuery(draft);
  const fileMentionPickerVisible = mentionQuery !== undefined;
  const filteredMentionFiles = fileMentionPickerVisible ? filterMentionableFiles(mentionableFiles, mentionQuery) : [];
  const safeFileMentionPickerIndex =
    filteredMentionFiles.length === 0 ? 0 : Math.min(fileMentionPickerIndex, Math.max(0, filteredMentionFiles.length - 1));
  const highlightedMentionFile = filteredMentionFiles[safeFileMentionPickerIndex];
  const modelPickerQuery = getModelPickerQuery(draft);
  const modelPickerVisible = modelPickerQuery !== undefined;
  const filteredModels = modelPickerVisible ? filterBuiltInModels(modelPickerQuery) : [];
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
    setSessionModel,
    createSession,
    renameSession,
    removeSession,
  } = useChatSessions({
    sessionsFile: runtime.sessionsFile,
    apiKeyPresent: Boolean(runtime.apiKey),
    defaultModel: runtime.model,
  });
  const sessionPickerQuery = getSessionPickerQuery(draft);
  const sessionPickerVisible = sessionPickerQuery !== undefined;
  const filteredSessions = sessionPickerVisible ? filterSessionsForPicker(recentSessions, sessionPickerQuery) : [];
  const safeSessionPickerIndex =
    filteredSessions.length === 0 ? 0 : Math.min(sessionPickerIndex, Math.max(0, filteredSessions.length - 1));
  const highlightedSession = filteredSessions[safeSessionPickerIndex];
  const preparePromptWithMentions = (prompt: string) => {
    const prepared = buildPromptWithFileMentions(prompt, runtime.workspaceRoot, mentionableFiles);
    return {
      prompt: prepared.runPrompt,
      displayText: prompt,
    };
  };

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const sessionModel = activeSession.model ?? runtime.model;
    if (sessionModel !== activeModel) {
      setActiveModel(sessionModel);
    }
  }, [activeModel, activeSession, runtime.model]);
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
    currentAssistantText,
    currentPlan,
    setLiveEvents,
    resetRunState,
    actionState,
    workingFrames,
  } = useApprovalFlow(nextLocalId);
  const messages = activeSession?.messages ?? [];
  const activityText = currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested);
  const contextStatus = formatContextStatus(
    activeModel,
    activeSession?.context?.lastRunInputTokens ?? activeSession?.context?.estimatedRequestTokens,
  );
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
        currentAssistantText,
        currentPlan,
      }
    : undefined;
  const switchSession = (id: string) => {
    setActiveSessionId(id);
    setDraft('');
    setDraftCursor(0);
    resetRunState({ abortInFlight: true });
  };

  const applyActiveModel = (model: string) => {
    setActiveModel(model);
    if (activeSession && activeSession.model !== model) {
      setSessionModel(activeSession.id, model);
    }
  };

  const closeSession = (id: string) => {
    const removedActive = removeSession(id);
    if (removedActive) {
      setDraft('');
      setDraftCursor(0);
      setPendingSubmittedPrompt(undefined);
      resetRunState({ abortInFlight: true });
    }
  };

  const appendPendingUserMessage = useCallback((prompt: string) => {
    const message: ConversationLine = {
      id: nextLocalId(),
      role: 'user',
      text: prompt,
      isPending: true,
    };

    updateActiveSession((session) => ({
      ...session,
      messages: [...session.messages, message],
    }));
  }, [updateActiveSession]);

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

  const submitPrompt = useCallback(async (value: string, options?: { allowWhileRunning?: boolean }) => {
    const effectiveIsRunning = options?.allowWhileRunning ? false : isRunning;

    if (effectiveIsRunning && !pendingApproval) {
      setPendingSubmittedPrompt(value);
      appendPendingUserMessage(value);
      return;
    }

    if (options?.allowWhileRunning && pendingSubmittedPrompt === value) {
      updateActiveSession((session) => {
        const pendingIndex = session.messages.findIndex(
          (message) => message.role === 'user' && message.text === value && message.isPending,
        );

        if (pendingIndex < 0) {
          return session;
        }

        return {
          ...session,
          messages: session.messages.map((message, index) =>
            index === pendingIndex ? { ...message, isPending: false } : message,
          ),
        };
      });
    }

    if (modelPickerVisible && highlightedModel) {
      setDraft('');
      setDraftCursor(0);
      setModelPickerIndex(0);
      await submitChatPrompt({
        value: `/model ${highlightedModel}`,
        isRunning: effectiveIsRunning,
        activeModel,
        setActiveModel: applyActiveModel,
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
        preparePrompt: preparePromptWithMentions,
        executeTurn,
        executeDirectShellCommand,
      });
      return;
    }

    if (sessionPickerVisible && highlightedSession) {
      setDraft('');
      setDraftCursor(0);
      setSessionPickerIndex(0);
      await submitChatPrompt({
        value: `/session switch ${highlightedSession.id}`,
        isRunning: effectiveIsRunning,
        activeModel,
        setActiveModel: applyActiveModel,
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
        preparePrompt: preparePromptWithMentions,
        executeTurn,
        executeDirectShellCommand,
      });
      return;
    }

    if (fileMentionPickerVisible && highlightedMentionFile) {
      const nextDraft = insertMentionSelection(value, highlightedMentionFile);
      setDraft(nextDraft);
      setDraftCursor(nextDraft.length);
      setFileMentionPickerIndex(0);
      return;
    }

    setModelPickerIndex(0);
    setSessionPickerIndex(0);
    setFileMentionPickerIndex(0);
    await submitChatPrompt({
      value,
      isRunning: effectiveIsRunning,
      activeModel,
      setActiveModel: applyActiveModel,
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
      preparePrompt: preparePromptWithMentions,
      executeTurn,
      executeDirectShellCommand,
    });
  }, [
    isRunning,
    pendingApproval,
    modelPickerVisible,
    highlightedModel,
    sessionPickerVisible,
    highlightedSession,
    fileMentionPickerVisible,
    highlightedMentionFile,
    activeModel,
    sessions,
    recentSessions,
    activeSessionId,
    activeSession,
    runtime.apiKey,
    setStatus,
    updateSessionById,
    updateActiveSession,
    createSession,
    renameSession,
    listRecentSessionsMessage,
    executeTurn,
    executeDirectShellCommand,
    appendPendingUserMessage,
    mentionableFiles,
    runtime.workspaceRoot,
    preparePromptWithMentions,
  ]);

  useEffect(() => {
    if (isRunning || pendingApproval || !pendingSubmittedPrompt) {
      return;
    }

    const queuedPrompt = pendingSubmittedPrompt;
    setPendingSubmittedPrompt(undefined);
    void submitPrompt(queuedPrompt, { allowWhileRunning: true });
  }, [isRunning, pendingApproval, pendingSubmittedPrompt, submitPrompt]);

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
          : isRunning ? 'Type freely • Enter queues prompt • Esc requests stop after the current step • Ctrl+C exits'
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
            {fileMentionPickerVisible ?
              <FileMentionPickerPanel
                query={mentionQuery}
                files={filteredMentionFiles}
                highlightedIndex={safeFileMentionPickerIndex}
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
                  cursor={draftCursor}
                  isDisabled={Boolean(pendingApproval)}
                  placeholder={isRunning ? "Keep typing while Heddle works" : "Ask Heddle about this project"}
                  maxVisibleLines={10}
                  onChange={setDraft}
                  onCursorChange={setDraftCursor}
                  onSpecialKey={({ key }) => {
                    if (modelPickerVisible) {
                      return handlePickerKeys({
                        key,
                        itemCount: filteredModels.length,
                        resetDraft: () => {
                          setDraft('');
                          setDraftCursor(0);
                        },
                        resetIndex: () => setModelPickerIndex(0),
                        advance: () => setModelPickerIndex((current) => (current + 1) % filteredModels.length),
                        retreat: () => setModelPickerIndex((current) => (current <= 0 ? filteredModels.length - 1 : current - 1)),
                      });
                    }

                    if (sessionPickerVisible) {
                      return handlePickerKeys({
                        key,
                        itemCount: filteredSessions.length,
                        resetDraft: () => {
                          setDraft('');
                          setDraftCursor(0);
                        },
                        resetIndex: () => setSessionPickerIndex(0),
                        advance: () => setSessionPickerIndex((current) => (current + 1) % filteredSessions.length),
                        retreat: () => setSessionPickerIndex((current) => (current <= 0 ? filteredSessions.length - 1 : current - 1)),
                      });
                    }

                    if (fileMentionPickerVisible) {
                      return handlePickerKeys({
                        key,
                        itemCount: filteredMentionFiles.length,
                        resetDraft: () => {
                          setDraft('');
                          setDraftCursor(0);
                        },
                        resetIndex: () => setFileMentionPickerIndex(0),
                        advance: () => setFileMentionPickerIndex((current) => (current + 1) % filteredMentionFiles.length),
                        retreat: () => setFileMentionPickerIndex((current) => (current <= 0 ? filteredMentionFiles.length - 1 : current - 1)),
                      });
                    }

                    return false;
                  }}
                  onSubmit={(value) => {
                    setDraft('');
                    setDraftCursor(0);
                    void submitPrompt(value);
                  }}
                />
              </Box>
            </Box>
            <Box justifyContent="space-between">
              <Text dimColor>
                {draft ? `${draft.length} chars`
                : isRunning ? 'Enter to queue'
                : 'Enter to send'}
              </Text>
              <Text dimColor>
                {pendingSubmittedPrompt ? '1 queued'
                : isRunning ? `${elapsedSeconds}s elapsed`
                : ''}
              </Text>
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

function formatContextStatus(model: string, estimatedRequestTokens?: number): string {
  if (estimatedRequestTokens === undefined) {
    return 'context=unknown';
  }

  const contextWindow = estimateBuiltInContextWindow(model);
  if (!contextWindow) {
    return `context≈${formatTokenCount(estimatedRequestTokens)} used`;
  }

  const remainingTokens = Math.max(contextWindow - estimatedRequestTokens, 0);
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
