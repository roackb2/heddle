import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildConversationMessages } from './utils/format.js';
import { buildCompactionRunningContext, compactChatHistoryWithArchive } from './state/compaction.js';
import { estimateBuiltInContextWindow } from '../../core/llm/openai-models.js';
import { credentialModeFromSource, resolveSystemSelectedModel } from '../../core/llm/model-policy.js';
import { useApprovalFlow } from './hooks/useApprovalFlow.js';
import { useAgentRun } from './hooks/useAgentRun.js';
import { useChatDrift } from './hooks/useChatDrift.js';
import { useChatPickers } from './hooks/useChatPickers.js';
import { useChatSessions } from './hooks/useChatSessions.js';
import { useChatStatusSummary } from './hooks/useChatStatusSummary.js';
import { useLocalIds } from './hooks/useLocalIds.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import { usePromptSubmission } from './hooks/usePromptSubmission.js';
import { autocompleteLocalCommand } from './state/local-commands.js';
import { listMentionableFiles } from './utils/file-mentions.js';
import { resolveProviderCredentialSourceForModel, type ChatRuntimeConfig } from './utils/runtime.js';

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
    createSession: createSessionWithDefaultModel,
    renameSession,
    removeSession,
  } = useChatSessions({
    sessionCatalogFile: runtime.sessionCatalogFile,
    apiKeyPresent: runtime.providerCredentialPresent,
    defaultModel: runtime.model,
    workspaceRoot: runtime.workspaceRoot,
    stateRoot: runtime.stateRoot,
  });
  const createSession = useCallback((name?: string) => createSessionWithDefaultModel(name, activeModel), [
    activeModel,
    createSessionWithDefaultModel,
  ]);
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

  const previousActiveModelRef = useRef(activeModel);
  const previousModelWriteSessionIdRef = useRef<string | undefined>(activeSession?.id);

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
  useEffect(() => {
    if (!activeSession) {
      previousActiveModelRef.current = activeModel;
      previousModelWriteSessionIdRef.current = undefined;
      return;
    }

    const sessionChanged = previousModelWriteSessionIdRef.current !== activeSession.id;
    previousModelWriteSessionIdRef.current = activeSession.id;
    if (sessionChanged) {
      previousActiveModelRef.current = activeModel;
      if (activeSession.model !== activeModel) {
        setSessionModel(activeSession.id, activeModel);
      }
      return;
    }

    if (activeSession.model !== activeModel) {
      setSessionModel(activeSession.id, activeModel);
    }

    const previousModel = previousActiveModelRef.current;
    previousActiveModelRef.current = activeModel;
    if (previousModel === activeModel) {
      return;
    }

    const previousWindow = estimateBuiltInContextWindow(previousModel);
    const nextWindow = estimateBuiltInContextWindow(activeModel);
    if (!nextWindow || (previousWindow !== undefined && nextWindow >= previousWindow)) {
      return;
    }

    const sessionId = activeSession.id;
    const sessionHistory = activeSession.history;
    const previousContext = activeSession.context;
    const previousArchives = activeSession.archives;

    setStatus('Compacting');
    updateSessionById(sessionId, (session) => ({
      ...session,
      model: activeModel,
      context: buildCompactionRunningContext({
        history: session.history,
        previous: session.context,
        archiveCount: session.archives?.length,
        currentSummaryPath: session.context?.currentSummaryPath,
      }),
    }));

    void compactChatHistoryWithArchive({
      history: sessionHistory,
      model: activeModel,
      sessionId,
      stateRoot: runtime.stateRoot,
      systemContext: runtime.systemContext,
      goal: `Model switched from ${previousModel} to ${activeModel}`,
      summarizer: { credentialSource: runtime.providerCredentialSource },
    }).then((compacted) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        model: activeModel,
        history: compacted.history,
        context: compacted.context,
        archives: compacted.archives,
        messages: buildConversationMessages(compacted.history),
      }));
      setStatus('Idle');
    }).catch(() => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        model: activeModel,
        context: previousContext,
        archives: previousArchives,
      }));
      setStatus('Idle');
    });
  }, [activeModel, activeSession, runtime.providerCredentialSource, runtime.stateRoot, runtime.systemContext, setStatus, setSessionModel, updateSessionById]);

  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession?.messages]);
  const sessionTitleModel = resolveSystemSelectedModel({
    purpose: 'session-title',
    provider: 'openai',
    activeModel,
    credentialMode: credentialModeFromSource(runtime.providerCredentialSource),
  });
  const {
    compacting,
    contextStatus,
    authStatus,
    sessionFooter,
    renderedStatus,
    statusHint,
    runtimeHostWarning,
    activeTurn,
  } = useChatStatusSummary({
    activeModel,
    activeSessionId,
    activeSession,
    runtimeHostWarningSource: runtime.runtimeHost,
    status,
    isRunning,
    isMemoryUpdating,
    error,
    liveEvents,
    elapsedSeconds,
    pendingApproval,
    approvalChoice,
    interruptRequested,
    currentAssistantText,
    currentPlan,
    workingFrame,
    workingFrames,
    credentialSource: resolveProviderCredentialSourceForModel(activeModel, runtime),
  });
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
  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    clearDraft();
    resetRunState({ abortInFlight: true });
  }, [clearDraft, resetRunState, setActiveSessionId]);

  const applyActiveModel = useCallback((model: string) => {
    setActiveModel(model);
    if (activeSession && activeSession.model !== model) {
      setSessionModel(activeSession.id, model);
    }
  }, [activeSession, setSessionModel]);

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
    sessionTitleModel,
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
