/**
 * TUI presentation composition root.
 *
 * Strict boundary:
 * - `App.tsx` is a view/presentation layer. It should render state and forward
 *   user intent only.
 * - Non-UI state must not be owned here. Session state, runtime state, policy,
 *   inheritance/default resolution, and domain logic belong in controller or
 *   domain modules.
 * - If a feature needs new stateful behavior, move that ownership outward
 *   instead of teaching `App.tsx` new policy or persistent semantics.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import {
  ApprovalComposer,
  CommandHintPanel,
  ConversationPanel,
  FileMentionPickerPanel,
  ModelPickerPanel,
  PromptInput,
  ReasoningEffortPickerPanel,
  SessionPickerPanel,
  shouldShowCommandHint,
  shouldShowSlashHints,
  SlashHintPanel,
} from './components/index.js';
import { buildTuiDebugSnapshot } from './debug/tui-debug-snapshot.js';
import { useApprovalFlow } from './hooks/useApprovalFlow.js';
import { useAgentRunController } from './hooks/controllers/useAgentRunController.js';
import { useChatAppController } from './hooks/controllers/useChatAppController.js';
import { useChatDrift } from './hooks/useChatDrift.js';
import { useChatPickers } from './hooks/useChatPickers.js';
import { useChatStatusSummary } from './hooks/useChatStatusSummary.js';
import { useLocalIds } from './hooks/useLocalIds.js';
import { usePromptDraft } from './hooks/usePromptDraft.js';
import { usePromptHistory } from './hooks/usePromptHistory.js';
import { usePromptSubmissionController } from './hooks/controllers/usePromptSubmissionController.js';
import { autocompleteLocalCommand } from './state/local-commands.js';
import { listMentionableFiles } from './utils/file-mentions.js';
import { resolveProviderCredentialSourceForModel, type ChatRuntimeConfig } from './utils/runtime.js';

export function App({ runtime }: { runtime: ChatRuntimeConfig }) {
  return <EmbeddedChatApp runtime={runtime} />;
}

function EmbeddedChatApp({ runtime }: { runtime: ChatRuntimeConfig }) {
  const nextLocalId = useLocalIds();
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 80;
  const {
    draft,
    setDraft,
    draftCursor,
    setDraftCursor,
    clearDraft,
    replaceDraft,
  } = usePromptDraft();
  const { promptHistory, recordPromptHistory } = usePromptHistory();
  const mentionableFiles = useState(() => listMentionableFiles(runtime.workspaceRoot, runtime.searchIgnoreDirs))[0];
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
  const {
    sessions,
    sessionService,
    refreshSessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    recentSessions,
    listRecentSessionsMessage,
    updateSessionById,
    updateActiveSession,
    createSession,
    renameSession,
    removeSession,
    activeModel,
    activeReasoningEffort,
    sessionTitleModel,
    modelCompatibilityNotice,
    applyActiveModel,
    applyActiveReasoningEffort,
  } = useChatAppController({
    runtime,
    setStatus,
  });
  const pickers = useChatPickers({
    draft,
    recentSessions,
    mentionableFiles,
    clearDraft,
    replaceDraft,
    providerCredentialSource: resolveProviderCredentialSourceForModel(activeModel, runtime),
    activeModel,
  });
  const drift = useChatDrift({
    activeSession,
    sessionService,
    refreshSessions,
  });

  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession?.messages]);
  const {
    compacting,
    contextStatus,
    reasoningStatus,
    authStatus,
    sessionFooter,
    renderedStatus,
    statusHint,
    runtimeHostWarning,
    activeTurn,
  } = useChatStatusSummary({
    activeModel,
    activeReasoningEffort,
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
        reasoningPicker: pickers.reasoning,
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
    pickers.reasoning,
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

  const closeSession = (id: string) => {
    const removedActive = removeSession(id);
    if (removedActive) {
      clearDraft();
      clearPendingSubmittedPrompt();
      resetRunState({ abortInFlight: true });
    }
  };

  const { executeTurn, executeDirectShellCommand } = useAgentRunController({
    runtime,
    activeModel,
    activeReasoningEffort,
    sessionTitleModel,
    activeSessionId,
    sessions,
    state: actionState,
    sessionService,
    refreshSessions,
    updateSessionById,
    drift: drift.observer,
  });

  const promptPanelWidth = Math.max(20, columns - 2);
  const promptBodyWidth = Math.max(1, promptPanelWidth - 2);
  const promptInputWidth = Math.max(1, promptBodyWidth - 2);

  const { pendingSubmittedPrompt, clearPendingSubmittedPrompt, submitPrompt } = usePromptSubmissionController({
    runtime,
    activeModel,
    activeReasoningEffort,
    setActiveModel: applyActiveModel,
    setActiveReasoningEffort: applyActiveReasoningEffort,
    sessions,
    recentSessions,
    activeSessionId,
    activeSession,
    apiKeyPresent: runtime.providerCredentialPresent,
    nextLocalId,
    setStatus,
    switchSession,
    closeSession,
    sessionService,
    refreshSessions,
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
    reasoningPicker: pickers.reasoning,
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
        {modelCompatibilityNotice ?
          <Text color="yellow">
            {modelCompatibilityNotice}
          </Text>
        : null}
      </Box>

      <ConversationPanel messages={messages} activeTurn={activeTurn} />

      <Box
        flexDirection="column"
        borderStyle={pendingApproval ? 'round' : undefined}
        borderColor={pendingApproval ? 'yellow' : undefined}
        paddingX={pendingApproval ? 1 : 0}
        paddingY={0}
        marginTop={1}
        width={promptPanelWidth}
        flexShrink={0}
      >
        {pendingApproval ?
          <>
            <Text bold color="yellow">
              Approval Required
            </Text>
            <ApprovalComposer pendingApproval={pendingApproval} approvalChoice={approvalChoice} />
          </>
        : <Box flexDirection="column" width={promptPanelWidth} flexShrink={0}>
            <Box width={promptPanelWidth} overflow="hidden">
              <Text dimColor wrap="truncate-end">{repeatSeparator(promptPanelWidth)}</Text>
            </Box>
            <Box
              flexDirection="column"
              width={promptBodyWidth}
              paddingX={1}
              paddingY={0}
            >
              {pickers.model.visible ?
                <ModelPickerPanel
                  query={pickers.model.query ?? ''}
                  models={pickers.model.items}
                  activeModel={activeModel}
                  highlightedIndex={pickers.model.highlightedIndex}
                />
              : null}
              {pickers.reasoning.visible ?
                <ReasoningEffortPickerPanel
                  query={pickers.reasoning.query ?? ''}
                  options={pickers.reasoning.items}
                  activeReasoningEffort={activeReasoningEffort}
                  highlightedIndex={pickers.reasoning.highlightedIndex}
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
                <PromptInput
                  value={draft}
                  cursor={draftCursor}
                  width={promptInputWidth}
                  promptHistory={promptHistory}
                  isDisabled={false}
                  placeholder={isRunning ? "Keep typing while Heddle works" : "Ask Heddle about this project"}
                  maxVisibleLines={10}
                  onChange={setDraft}
                  onCursorChange={setDraftCursor}
                  onSpecialKey={handlePromptSpecialKey}
                  onSubmit={(value) => {
                    recordPromptHistory(value);
                    clearDraft();
                    void submitPrompt(value);
                  }}
                />
              </Box>
              <Box justifyContent="space-between" flexWrap="nowrap" width={promptBodyWidth}>
                <Box flexShrink={1} marginRight={1}>
                  <Text dimColor wrap="truncate-end">
                    {draft ? `${draft.length} chars`
                    : isRunning ? 'Enter to queue'
                    : 'Enter to send'}
                  </Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor>
                    {pendingSubmittedPrompt ? '1 queued'
                    : isRunning ? `${elapsedSeconds}s elapsed`
                    : ''}
                  </Text>
                </Box>
              </Box>
            </Box>
            <Box width={promptPanelWidth} overflow="hidden">
              <Text dimColor wrap="truncate-end">{repeatSeparator(promptPanelWidth)}</Text>
            </Box>
          </Box>}
      </Box>
      <Box width={promptPanelWidth} overflow="hidden">
        <Text dimColor wrap="truncate-end">{`model=${activeModel} • reasoning=${reasoningStatus} • ${authStatus} • ${contextStatus} • drift=${drift.footer} • ${sessionFooter}`}</Text>
      </Box>
    </Box>
  );
}

function repeatSeparator(width: number): string {
  return '─'.repeat(Math.max(0, width));
}
