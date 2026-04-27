import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { buildTuiDebugSnapshot } from './debug/tui-debug-snapshot.js';
import { estimateBuiltInContextWindow } from '../../core/llm/openai-models.js';
import { useApprovalFlow } from './hooks/useApprovalFlow.js';
import { useAgentRun } from './hooks/useAgentRun.js';
import { useChatDrift } from './hooks/useChatDrift.js';
import { useChatPickers } from './hooks/useChatPickers.js';
import { useChatSessions } from './hooks/useChatSessions.js';
import { useLocalIds } from './hooks/useLocalIds.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import { usePromptSubmission } from './hooks/usePromptSubmission.js';
import { autocompleteLocalCommand } from './state/local-commands.js';
import { currentActivityText } from './utils/format.js';
import { listMentionableFiles } from './utils/file-mentions.js';
import { resolveProviderCredentialSourceForModel, type ChatRuntimeConfig, type ProviderCredentialSource } from './utils/runtime.js';

const SESSION_TITLE_MODEL = 'gpt-5.1-codex-mini';

export function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  return <EmbeddedChatApp runtime={runtime} />;
}

function EmbeddedChatApp({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextLocalId = useLocalIds();
  const [activeModel, setActiveModel] = useState(runtime.model);
  const {
    draft,
    setDraft,
    draftCursor,
    setDraftCursor,
    clearDraft,
    replaceDraft,
  } = usePromptDraft();
  const mentionableFiles = useState(() => listMentionableFiles(runtime.workspaceRoot, runtime.searchIgnoreDirs))[0];

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    setSessionModel,
    createSession,
    renameSession,
    removeSession,
  } = useChatSessions({
    sessionCatalogFile: runtime.sessionCatalogFile,
    apiKeyPresent: runtime.providerCredentialPresent,
    defaultModel: runtime.model,
    workspaceRoot: runtime.workspaceRoot,
    stateRoot: runtime.stateRoot,
  });
  const pickers = useChatPickers({
    draft,
    recentSessions,
    mentionableFiles,
    clearDraft,
    replaceDraft,
  });
  const drift = useChatDrift({
    activeSession,
    updateActiveSession,
  });

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
    isMemoryUpdating,
    error,
    liveEvents,
    workingFrame,
    elapsedSeconds,
    pendingApproval,
    approvalChoice,
    interruptRequested,
    currentAssistantText,
    currentPlan,
    resetRunState,
    actionState,
    workingFrames,
  } = useApprovalFlow(nextLocalId);
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession?.messages]);
  const compacting = activeSession?.context?.compactionStatus === 'running';
  const activityText = currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested);
  const contextStatus = formatContextStatus(
    activeModel,
    activeSession?.context?.lastRunInputTokens ?? activeSession?.context?.estimatedRequestTokens,
  );
  const authStatus = formatAuthStatus(resolveProviderCredentialSourceForModel(activeModel, runtime));
  const sessionFooter = `session=${activeSession?.id ?? activeSessionId}${activeSession?.name ? ` (${activeSession.name})` : ''}`;
  const renderedStatus =
    pendingApproval ? 'awaiting approval'
    : compacting ? 'compacting'
    : interruptRequested ? 'interrupt requested'
    : isRunning ? 'running'
    : isMemoryUpdating ? 'memory updating'
    : status;
  const statusHint =
    pendingApproval ? '←/→ choose • Enter confirms • A remembers for this project • Esc denies • Ctrl+C exits'
    : compacting ? 'Compacting archived history in the background • Ctrl+C exits'
    : isRunning ? 'Type freely • Enter queues prompt • Esc requests stop after the current step • Ctrl+C exits'
    : isMemoryUpdating ? 'Memory maintenance is running in the background • Enter sends • Ctrl+C exits'
    : 'Enter sends • Tab completes slash commands • /help shows commands • !command runs shell • Ctrl+C exits';
  const runtimeHostWarning =
    runtime.runtimeHost?.kind === 'daemon' && !runtime.runtimeHost.stale ?
      `Daemon is also attached to this workspace at http://${runtime.runtimeHost.endpoint.host}:${runtime.runtimeHost.endpoint.port}. Different sessions are fine; avoid writing to the same session from multiple clients.`
    : undefined;
  const activityLines = liveEvents
    .slice(-4)
    .filter((event, index, events) => events.findIndex((candidate) => candidate.text === event.text) === index)
    .map((event, index, events) => {
      if (isRunning && index === events.length - 1) {
        return `${event.text} · ${elapsedSeconds}s`;
      }

      return event.text;
    });
  const activeTurn = useMemo(
    () =>
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
      : undefined,
    [
      isRunning,
      pendingApproval,
      interruptRequested,
      error,
      activityText,
      activityLines,
      currentAssistantText,
      currentPlan,
    ],
  );
  const saveTuiSnapshotMessage = useCallback(() => {
    if (!runtime.saveTuiSnapshot) {
      return 'TUI snapshots are not available in this runtime.';
    }

    const saved = runtime.saveTuiSnapshot({
      sessionId: activeSessionId,
      model: activeModel,
      status:
        pendingApproval ? 'awaiting-approval'
        : isRunning ? 'running'
        : compacting ? 'compacting'
        : 'idle',
      textSnapshot: buildTuiDebugSnapshot({
        sessionName: activeSession?.name ?? 'unknown',
        activeModel,
        maxSteps: runtime.maxSteps,
        status: renderedStatus,
        hint: statusHint,
        contextStatus,
        sessionFooter,
        activeSessionId,
        sessions,
        messages,
        activeTurn,
        pendingApproval,
        approvalChoice,
        draft,
        draftCursor,
        showSlashHints: shouldShowSlashHints(draft),
        showCommandHint: shouldShowCommandHint(draft),
        modelPicker: pickers.model,
        sessionPicker: pickers.session,
        fileMentionPicker: pickers.fileMention,
      }),
    });

    return [
      `Saved TUI snapshot at ${saved.capturedAt}.`,
      `Text: ${saved.txtPath}`,
      `ANSI: ${saved.ansiPath}`,
      `Metadata: ${saved.jsonPath}`,
    ].join('\n');
  }, [
    runtime,
    activeSessionId,
    activeModel,
    pendingApproval,
    isRunning,
    compacting,
    activeSession,
    contextStatus,
    sessionFooter,
    sessions,
    messages,
    activeTurn,
    approvalChoice,
    draft,
    draftCursor,
    pickers.model,
    pickers.session,
    pickers.fileMention,
    renderedStatus,
    statusHint,
  ]);
  const handlePromptSpecialKey = useCallback((event: Parameters<typeof pickers.handleSpecialKey>[0]) => {
    if (pickers.handleSpecialKey(event)) {
      return true;
    }

    if (!event.key.tab || draftCursor !== draft.length) {
      return false;
    }

    const completed = autocompleteLocalCommand(draft, activeSession?.id ?? activeSessionId, sessions);
    if (!completed || completed === draft) {
      return false;
    }

    replaceDraft(completed);
    return true;
  }, [pickers, draftCursor, draft, activeSession, activeSessionId, sessions, replaceDraft]);
  const switchSession = (id: string) => {
    setActiveSessionId(id);
    clearDraft();
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
      clearDraft();
      clearPendingSubmittedPrompt();
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
    drift: drift.observer,
  });

  const { pendingSubmittedPrompt, clearPendingSubmittedPrompt, submitPrompt } = usePromptSubmission({
    runtime,
    activeModel,
    setActiveModel: applyActiveModel,
    sessions,
    recentSessions,
    activeSessionId,
    activeSession,
    apiKeyPresent: runtime.providerCredentialPresent,
    nextLocalId,
    setStatus,
    switchSession,
    closeSession,
    updateSessionById,
    updateActiveSession,
    createSession,
    renameSession,
    listRecentSessionsMessage,
    driftEnabled: drift.enabled,
    driftError: drift.error,
    setDriftEnabled: drift.setEnabled,
    saveTuiSnapshotMessage,
    isRunning,
    pendingApproval,
    executeTurn,
    executeDirectShellCommand,
    mentionableFiles,
    modelPicker: pickers.model,
    sessionPicker: pickers.session,
    fileMentionPicker: pickers.fileMention,
    resetPickerIndexes: pickers.resetPickerIndexes,
  });

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
          status={renderedStatus}
        </Text>
        <Text dimColor>
          {statusHint}
        </Text>
        {runtimeHostWarning ?
          <Text color="yellow">
            {runtimeHostWarning}
          </Text>
        : null}
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
          {pendingApproval ? 'Approval Required' : compacting ? 'Compacting…' : isRunning ? `Working${workingFrames[workingFrame]}` : 'Prompt'}
        </Text>
        {pendingApproval ?
          <ApprovalComposer pendingApproval={pendingApproval} approvalChoice={approvalChoice} />
        : <>
            {pickers.model.visible ?
              <ModelPickerPanel
                query={pickers.model.query ?? ''}
                models={pickers.model.items}
                activeModel={activeModel}
                highlightedIndex={pickers.model.highlightedIndex}
              />
            : null}
            {pickers.session.visible ?
              <SessionPickerPanel
                query={pickers.session.query ?? ''}
                sessions={pickers.session.items}
                activeSessionId={activeSessionId}
                highlightedIndex={pickers.session.highlightedIndex}
              />
            : null}
            {pickers.fileMention.visible ?
              <FileMentionPickerPanel
                query={pickers.fileMention.query ?? ''}
                files={pickers.fileMention.items}
                highlightedIndex={pickers.fileMention.highlightedIndex}
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
                  onSpecialKey={handlePromptSpecialKey}
                  onSubmit={(value) => {
                    clearDraft();
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
      <Text>
        <Text dimColor>{`model=${activeModel} • ${authStatus} • ${contextStatus} • `}</Text>
        <Text color={drift.color} dimColor={!drift.color}>{`drift=${drift.footer}`}</Text>
        <Text dimColor>{` • ${sessionFooter}`}</Text>
      </Text>
    </Box>
  );
}

function formatAuthStatus(source: ProviderCredentialSource): string {
  switch (source.type) {
    case 'explicit-api-key':
      return 'auth=explicit-key';
    case 'env-api-key':
      return `auth=${source.provider}-key`;
    case 'oauth':
      return source.accountId ? `auth=${source.provider}-oauth:${source.accountId.slice(0, 8)}` : `auth=${source.provider}-oauth`;
    case 'missing':
      return `auth=missing-${source.provider}`;
  }
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
