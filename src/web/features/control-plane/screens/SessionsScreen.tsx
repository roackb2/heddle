import { useEffect, useRef, useState } from 'react';
import {
  type ChatSessionDetail,
  type ChatTurnReview,
  type ControlPlaneState,
} from '../../../lib/api';
import { formatControlPlaneAuthStatus } from '../auth-status';
import { formatDate, className } from '../utils';
import { CodeBlock, EmptyState, Pill, WorkspaceSectionHeader } from '../components/common';
import { SessionListButton } from '../components/lists';
import { ConversationMessage } from '../components/ConversationMessage';
import { ModelSelectorPopover } from '../components/ModelSelectorPopover.js';
import { useResizableSessionPanels } from '../hooks/sessions-screen/useResizableSessionPanels.js';
import { useSessionComposer } from '../hooks/sessions-screen/useSessionComposer.js';
import { useSessionMobileNavigation } from '../hooks/sessions-screen/useSessionMobileNavigation.js';
import { useSessionModelOptions } from '../hooks/sessions-screen/useSessionModelOptions.js';
import { useWorkspaceReviewState } from '../hooks/sessions-screen/useWorkspaceReviewState.js';
import { FullDiffDialog, SessionReviewPanel, type ExpandedDiff, type ReviewMode } from './SessionReviewPanel';
import { FileMentionMenu } from './sessions-screen/FileMentionMenu.js';
import { SessionsMobileLayout } from './sessions-screen/SessionsMobileLayout.js';
import { formatDriftLabel } from './sessions-screen/sessionScreenUtils.js';

export type SessionTurn = Exclude<ChatSessionDetail, null>['turns'][number];

export type SessionsScreenProps = {
  sessions: ControlPlaneState['sessions'];
  activeSession?: ControlPlaneState['sessions'][number];
  sessionDetail: ChatSessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError?: string;
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  selectedTurnId?: string;
  onSelectTurn: (turnId: string) => void;
  selectedTurn?: SessionTurn;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  sendingPrompt: boolean;
  runInFlight: boolean;
  memoryUpdating: boolean;
  auth: ControlPlaneState['auth'];
  sendPromptError?: string;
  onSendPrompt: (prompt: string) => Promise<void>;
  creatingSession: boolean;
  sessionNotice?: string;
  onCreateSession: () => Promise<void>;
  onContinueSession: () => Promise<void>;
  onCancelSessionRun: () => Promise<void>;
  onUpdateSessionSettings: (settings: { model?: string; driftEnabled?: boolean }) => Promise<void>;
  pendingApproval: { tool: string; callId: string; input?: unknown; requestedAt: string } | null;
  onResolveApproval: (approved: boolean) => Promise<void>;
};

export function SessionsScreen({
  sessions,
  activeSession,
  sessionDetail,
  sessionDetailLoading,
  sessionDetailError,
  selectedSessionId,
  onSelectSession,
  selectedTurnId,
  onSelectTurn,
  selectedTurn,
  turnReview,
  turnReviewLoading,
  turnReviewError,
  sendingPrompt,
  runInFlight,
  memoryUpdating,
  auth,
  sendPromptError,
  onSendPrompt,
  creatingSession,
  sessionNotice,
  onCreateSession,
  onContinueSession,
  onCancelSessionRun,
  onUpdateSessionSettings,
  pendingApproval,
  onResolveApproval,
}: SessionsScreenProps) {
  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const [selectedReviewFilePath, setSelectedReviewFilePath] = useState<string | undefined>();
  const [reviewMode, setReviewMode] = useState<ReviewMode>('current');
  const [expandedDiff, setExpandedDiff] = useState<ExpandedDiff | null>(null);
  const {
    textareaRef,
    draft,
    mentionQuery,
    mentionSuggestions,
    mentionLoading,
    mentionError,
    activeMentionIndex,
    updateDraft,
    insertMention,
    submitDraft,
    handleComposerKeyDown,
  } = useSessionComposer({ onSendPrompt });
  const { shellRef, workspaceStyle, startPanelResize } = useResizableSessionPanels();
  const {
    mobileView,
    shellClassName,
    selectSession,
    selectTurn,
    showSessionList,
    showChatView,
    openReviewInspector,
  } = useSessionMobileNavigation({
    selectedSessionId,
    onSelectSession,
    onSelectTurn,
  });
  const runActive = sendingPrompt || runInFlight;
  const authStatus = formatControlPlaneAuthStatus(sessionDetail?.model ?? activeSession?.model, auth);
  const compactionStatus = sessionDetail?.context?.compactionStatus ?? activeSession?.context?.compactionStatus;
  const selectedModel = sessionDetail?.model ?? activeSession?.model ?? '';
  const {
    modelOptions,
    modelOptionsError,
    modelOptionGroups,
    selectedModelOption,
    modelSelectorDisabled,
  } = useSessionModelOptions({
    auth,
    selectedModel,
    runActive,
  });
  const {
    workspaceChanges,
    workspaceChangesLoading,
    workspaceChangesError,
    workspaceFileDiff,
    workspaceFileDiffsByPath,
    workspaceFileDiffLoading,
    workspaceFileDiffError,
    selectedTurnPatchIsStale,
    selectWorkspaceFile,
    refreshWorkspaceReview,
  } = useWorkspaceReviewState({
    runActive,
    sessionUpdatedAt: sessionDetail?.updatedAt,
    turnReview,
    selectedReviewFilePath,
  });
  const firstReviewFilePath = turnReview?.files[0]?.path;

  useEffect(() => {
    const element = conversationScrollRef.current;
    if (!element) {
      return;
    }

    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      timeout = window.setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [mobileView, selectedSessionId, sessionDetail?.messages.length, sessionDetailLoading, sessionDetailError]);

  useEffect(() => {
    setSelectedReviewFilePath(firstReviewFilePath);
  }, [firstReviewFilePath, selectedTurnId, turnReview?.traceFile]);

  const mentionMenu = mentionQuery ?
    <FileMentionMenu
      loading={mentionLoading}
      suggestions={mentionSuggestions}
      activeIndex={activeMentionIndex}
      error={mentionError}
      query={mentionQuery.query}
      onPick={insertMention}
    />
  : null;

  const showMobileLayout = typeof window !== 'undefined' && window.innerWidth <= 760;

  if (showMobileLayout) {
    return (
      <SessionsMobileLayout
        mobileView={mobileView}
        sessions={sessions}
        activeSession={activeSession}
        sessionDetail={sessionDetail}
        sessionDetailLoading={sessionDetailLoading}
        sessionDetailError={sessionDetailError}
        selectedSessionId={selectedSessionId}
        selectedTurnId={selectedTurnId}
        selectedTurn={selectedTurn}
        turnReview={turnReview}
        turnReviewLoading={turnReviewLoading}
        turnReviewError={turnReviewError}
        runActive={runActive}
        runInFlight={runInFlight}
        memoryUpdating={memoryUpdating}
        authStatus={authStatus}
        sendPromptError={sendPromptError}
        sessionNotice={sessionNotice}
        draft={draft}
        pendingApproval={pendingApproval}
        conversationScrollRef={conversationScrollRef}
        textareaRef={textareaRef}
        mentionMenu={mentionMenu}
        workspaceChanges={workspaceChanges}
        workspaceChangesLoading={workspaceChangesLoading}
        workspaceChangesError={workspaceChangesError}
        workspaceFileDiff={workspaceFileDiff}
        workspaceFileDiffsByPath={workspaceFileDiffsByPath}
        workspaceFileDiffLoading={workspaceFileDiffLoading}
        workspaceFileDiffError={workspaceFileDiffError}
        selectedTurnPatchIsStale={selectedTurnPatchIsStale}
        expandedDiff={expandedDiff}
        creatingSession={creatingSession}
        onCreateSession={onCreateSession}
        onSelectSession={selectSession}
        onSelectTurn={selectTurn}
        onDraftChange={updateDraft}
        onComposerKeyDown={handleComposerKeyDown}
        onBackToSessions={showSessionList}
        onOpenReview={openReviewInspector}
        onSubmitPrompt={submitDraft}
        onContinueSession={onContinueSession}
        onCancelSessionRun={onCancelSessionRun}
        onResolveApproval={onResolveApproval}
        onSelectWorkspaceFile={selectWorkspaceFile}
        onRefreshWorkspaceReview={refreshWorkspaceReview}
        onOpenDiff={setExpandedDiff}
        onOpenChat={showChatView}
        onCloseDiff={() => setExpandedDiff(null)}
      />
    );
  }

  return (
    <section className={shellClassName} ref={shellRef} style={workspaceStyle} data-mobile-view={mobileView}>
      <aside className="workspace-sidebar">
        <WorkspaceSectionHeader
          title="Sessions"
          subtitle={`${sessions.length} saved conversation${sessions.length === 1 ? '' : 's'}`}
          actions={<button className="sidebar-action-button" type="button" data-testid="new-session-button" disabled={creatingSession} onClick={() => void onCreateSession()}>{creatingSession ? 'Creating…' : '+ New session'}</button>}
        />
        <div className="sidebar-scroll">
          {sessions.length ?
            <div className="stack-list compact">
              {sessions.map((session) => (
                <SessionListButton
                  key={session.id}
                  session={session}
                  active={session.id === selectedSessionId}
                  onClick={() => selectSession(session.id)}
                />
              ))}
            </div>
          : <div className="sidebar-empty-state"><EmptyState title="No sessions" body="Create a new web session to start a fresh conversation in the browser." /></div>}
        </div>
      </aside>

      <button
        className="workspace-resizer"
        type="button"
        aria-label="Resize sessions sidebar"
        onPointerDown={(event) => startPanelResize('left', event)}
      />

      <section className="workspace-main">
        <WorkspaceSectionHeader
          title={sessionDetail?.name ?? activeSession?.name ?? 'Chat session'}
          subtitle={activeSession ? `${activeSession.id} · updated ${formatDate(activeSession.updatedAt)}` : 'Pick a session to inspect its conversation.'}
          actions={activeSession ? (
            <div className="session-controls">
              <button className="mobile-nav-button" type="button" onClick={showSessionList}>← Sessions</button>
              <button className="mobile-nav-button mobile-inspector-button" type="button" onClick={openReviewInspector}>Review</button>
              <div className="model-select-control">
                <label className="select-control">
                  <span>model</span>
                  <ModelSelectorPopover
                    selectedModel={selectedModel}
                    selectedModelUnsupported={Boolean(selectedModelOption?.disabled)}
                    disabled={modelSelectorDisabled}
                    groups={modelOptionGroups}
                    runActive={runActive}
                    modelOptionsError={modelOptionsError}
                    onSelectModel={(model) => void onUpdateSessionSettings({ model })}
                  />
                </label>
                {!modelOptions ? <p className="model-select-description">{modelOptionsError ? 'models unavailable' : 'loading models'}</p> : null}
              </div>
              <Pill>turns {activeSession.turnCount}</Pill>
              {compactionStatus === 'running' ? <Pill tone="warn">compacting</Pill> : null}
              <button
                className={className('drift-button', (sessionDetail?.driftEnabled ?? activeSession.driftEnabled) && 'active')}
                type="button"
                disabled={runActive}
                onClick={() => void onUpdateSessionSettings({ driftEnabled: !(sessionDetail?.driftEnabled ?? activeSession.driftEnabled ?? true) })}
              >
                {formatDriftLabel(sessionDetail?.driftEnabled ?? activeSession.driftEnabled, sessionDetail?.driftLevel ?? activeSession.driftLevel)}
              </button>
              {runActive ? <Pill tone="warn">working</Pill> : null}
            </div>
          ) : undefined}
        />

        <div className="conversation-scroll" ref={conversationScrollRef}>
          <div className="conversation-stack">
            <div className="conversation-spacer" />
            {sessionDetailLoading ?
              <EmptyState title="Loading session" body="Fetching full conversation state from saved Heddle session storage." />
            : sessionDetailError ?
              <EmptyState title="Session load failed" body={sessionDetailError} />
            : sessionDetail && sessionDetail.messages.length ?
              sessionDetail.messages.map((message) => <ConversationMessage key={message.id} message={message} />)
            : <EmptyState title="No conversation available" body="This session does not have any saved chat messages yet." />}
          </div>
        </div>

        <div className="composer-shell">
          {pendingApproval ?
            <div className="detail-card error-card approval-card">
              <p className="card-title">Approval required: {pendingApproval.tool}</p>
              <p className="muted">Call ID: {pendingApproval.callId}</p>
              <CodeBlock>{JSON.stringify(pendingApproval.input, null, 2)}</CodeBlock>
              <div className="pills approval-actions">
                <button className="primary-button" type="button" onClick={() => void onResolveApproval(true)}>Approve</button>
                <button className="tab-button" type="button" onClick={() => void onResolveApproval(false)}>Deny</button>
              </div>
            </div>
          : null}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
            onClick={(event) => updateDraft(draft, event.currentTarget.selectionStart)}
            onSelect={(event) => updateDraft(draft, event.currentTarget.selectionStart)}
            disabled={!selectedSessionId || runActive}
            placeholder={runActive ? 'Heddle is working…' : 'Ask Heddle about this workspace'}
            onKeyDown={handleComposerKeyDown}
          />
          {mentionMenu}
          <div className="composer-footer">
            <div className="composer-status">
              <p className="muted">
                {compactionStatus === 'running' ? 'Compacting earlier conversation history into an archive summary.'
                : sendPromptError ? sendPromptError
                : sessionNotice ? sessionNotice
                : runActive ? 'Run in progress. Continue is disabled until this run settles; Cancel interrupts the active run.'
                : memoryUpdating ? 'Memory maintenance is updating the workspace catalog in the background.'
                : sessionDetail?.lastContinuePrompt ? 'Enter sends. Option+Enter or Shift+Enter adds a new line.'
                : 'Enter sends. Option+Enter or Shift+Enter adds a new line.'}
              </p>
              <div className="pills compact-pills">
                <Pill tone={creatingSession ? 'warn' : runActive ? 'warn' : 'good'}>{creatingSession ? 'creating session' : runActive ? 'run active' : 'idle'}</Pill>
                {memoryUpdating ? <Pill tone="warn">memory updating</Pill> : null}
                {authStatus ? <Pill>{authStatus}</Pill> : null}
                {sessionDetail?.lastContinuePrompt ? <Pill>continue available</Pill> : <Pill>no continue state yet</Pill>}
              </div>
            </div>
            <div className="pills composer-actions">
              <button
                className="tab-button"
                type="button"
                disabled={!selectedSessionId || runActive || !sessionDetail?.lastContinuePrompt}
                onClick={() => void onContinueSession()}
                title={sessionDetail?.lastContinuePrompt ? 'Resume the current transcript from the last saved continue point' : 'Continue is available after a prior runnable turn exists'}
              >
                Continue
              </button>
              <button
                className="tab-button"
                type="button"
                disabled={!runInFlight}
                onClick={() => void onCancelSessionRun()}
                title="Interrupt the currently running session"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!selectedSessionId || runActive || !draft.trim()}
                onClick={submitDraft}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </section>

      <button
        className="workspace-resizer"
        type="button"
        aria-label="Resize session inspector"
        onPointerDown={(event) => startPanelResize('right', event)}
      />

      <SessionReviewPanel
        reviewMode={reviewMode}
        onReviewModeChange={setReviewMode}
        onShowChatView={showChatView}
        workspaceChanges={workspaceChanges}
        workspaceChangesLoading={workspaceChangesLoading}
        workspaceChangesError={workspaceChangesError}
        workspaceFileDiffsByPath={workspaceFileDiffsByPath}
        workspaceFileDiffLoading={workspaceFileDiffLoading}
        workspaceFileDiffError={workspaceFileDiffError}
        selectedTurnPatchIsStale={selectedTurnPatchIsStale}
        onSelectWorkspaceFile={selectWorkspaceFile}
        onRefreshWorkspaceReview={refreshWorkspaceReview}
        sessionDetail={sessionDetail}
        selectedTurnId={selectedTurnId}
        onSelectTurn={selectTurn}
        turnReview={turnReview}
        turnReviewLoading={turnReviewLoading}
        turnReviewError={turnReviewError}
        onSelectReviewFile={setSelectedReviewFilePath}
        selectedTurn={selectedTurn}
        onOpenDiff={setExpandedDiff}
      />
      <FullDiffDialog diff={expandedDiff} onClose={() => setExpandedDiff(null)} />
    </section>
  );
}
