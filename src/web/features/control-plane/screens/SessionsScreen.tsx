import { useEffect, useRef, useState } from 'react';
import {
  type ChatSessionDetail,
  type ChatTurnReview,
  type ControlPlaneState,
  type WorkspaceFileSuggestion,
} from '../../../lib/api';
import { formatControlPlaneAuthStatus } from '../auth-status';
import { formatDate, className } from '../utils';
import { CodeBlock, EmptyState, Pill, WorkspaceSectionHeader } from '../components/common';
import { SessionListButton } from '../components/lists';
import { ConversationMessage } from '../components/ConversationMessage';
import { ModelSelectorPopover } from '../components/ModelSelectorPopover.js';
import { useResizableSessionPanels } from '../hooks/useResizableSessionPanels.js';
import { useSessionComposer } from '../hooks/useSessionComposer.js';
import { useSessionMobileNavigation } from '../hooks/useSessionMobileNavigation.js';
import { useSessionModelOptions } from '../hooks/useSessionModelOptions.js';
import { useWorkspaceReviewState } from '../hooks/useWorkspaceReviewState.js';
import { MobileChatScreen } from '../mobile/MobileChatScreen';
import { MobileReviewScreen } from '../mobile/MobileReviewScreen';
import { FullDiffDialog, SessionReviewPanel, type ExpandedDiff, type ReviewMode } from './SessionReviewPanel';

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
    selectedWorkspaceFile,
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

  if (showMobileLayout && mobileView === 'list') {
    return (
      <section className="mobile-session-screen mobile-session-list">
        <aside className="workspace-sidebar mobile-pane">
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
      </section>
    );
  }

  if (showMobileLayout && mobileView === 'chat') {
    return (
      <MobileChatScreen
        activeSession={activeSession}
        sessionDetail={sessionDetail}
        sessionDetailLoading={sessionDetailLoading}
        sessionDetailError={sessionDetailError}
        selectedSessionId={selectedSessionId}
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
        renderMessage={(message) => <ConversationMessage key={message.id} message={message} />}
        onDraftChange={updateDraft}
        onComposerKeyDown={handleComposerKeyDown}
        onBackToSessions={showSessionList}
        onOpenReview={openReviewInspector}
        onSubmitPrompt={submitDraft}
        onContinueSession={() => void onContinueSession()}
        onCancelSessionRun={() => void onCancelSessionRun()}
        onResolveApproval={(approved) => void onResolveApproval(approved)}
      />
    );
  }

  if (showMobileLayout && mobileView === 'review') {
    return (
      <>
        <MobileReviewScreen
          activeSession={activeSession}
          sessionDetail={sessionDetail}
          selectedTurnId={selectedTurnId}
          selectedTurn={selectedTurn}
          turnReview={turnReview}
          turnReviewLoading={turnReviewLoading}
          turnReviewError={turnReviewError}
          workspaceChanges={workspaceChanges}
          workspaceChangesLoading={workspaceChangesLoading}
          workspaceChangesError={workspaceChangesError}
          workspaceFileDiff={workspaceFileDiff}
          workspaceFileDiffsByPath={workspaceFileDiffsByPath}
          workspaceFileDiffLoading={workspaceFileDiffLoading}
          workspaceFileDiffError={workspaceFileDiffError}
          onSelectWorkspaceFile={selectWorkspaceFile}
          onRefreshWorkspaceReview={refreshWorkspaceReview}
          selectedTurnPatchIsStale={selectedTurnPatchIsStale}
          onOpenDiff={setExpandedDiff}
          onBackToSessions={showSessionList}
          onOpenChat={showChatView}
          onSelectTurn={selectTurn}
        />
        <FullDiffDialog diff={expandedDiff} onClose={() => setExpandedDiff(null)} />
      </>
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

function formatDriftLabel(enabled: boolean | undefined, level: ControlPlaneState['sessions'][number]['driftLevel']): string {
  if (!enabled) {
    return 'drift off';
  }

  return `drift ${level ?? 'unknown'}`;
}

function FileMentionMenu({
  loading,
  suggestions,
  activeIndex,
  error,
  query,
  onPick,
}: {
  loading: boolean;
  suggestions: WorkspaceFileSuggestion[];
  activeIndex: number;
  error?: string;
  query: string;
  onPick: (suggestion: WorkspaceFileSuggestion) => void;
}) {
  return (
    <div className="mention-menu" role="listbox" aria-label="File suggestions">
      <div className="mention-menu-header">
        <span>@ file</span>
        <span>{loading ? 'Searching...' : `${suggestions.length} match${suggestions.length === 1 ? '' : 'es'}`}</span>
      </div>
      {error ?
        <p className="mention-empty">File search unavailable. Restart the Heddle daemon if this route was just added.</p>
      : suggestions.length ?
        suggestions.map((suggestion, index) => (
          <button
            key={suggestion.path}
            className={className('mention-option', index === activeIndex && 'active')}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(suggestion);
            }}
          >
            <span>@{suggestion.path}</span>
          </button>
        ))
      : <p className="mention-empty">{loading ? 'Searching workspace files...' : `No files found for "${query}".`}</p>}
    </div>
  );
}
