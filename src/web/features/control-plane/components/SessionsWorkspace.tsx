import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import {
  fetchModelOptions,
  fetchWorkspaceFileSuggestions,
  type ChatSessionDetail,
  type ChatTurnReview,
  type ControlPlaneState,
  type ModelOptions,
  type WorkspaceFileSuggestion,
} from '../../../lib/api';
import { formatDate, formatNumber, toneFor, className } from '../utils';
import { CodeBlock, EmptyState, Pill, SideSection, WorkspaceSectionHeader } from './common';
import { CommandList, SessionListButton, TurnListButton } from './lists';
import { MobileChatScreen } from '../mobile/MobileChatScreen';
import { MobileSessionNav } from '../mobile/MobileSessionNav';

export type SessionTurn = Exclude<ChatSessionDetail, null>['turns'][number];

const PANEL_WIDTH_STORAGE_KEY = 'heddle.controlPlane.sessionPanelWidths';
const PANEL_HANDLE_WIDTH = 12;
const MAIN_PANEL_MIN_WIDTH = 420;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 620;

export type SessionsWorkspaceProps = {
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
  inspectorTab: 'summary' | 'review';
  onInspectorTabChange: (tab: 'summary' | 'review') => void;
};

export function SessionsWorkspace({
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
  inspectorTab,
  onInspectorTabChange,
}: SessionsWorkspaceProps) {
  const shellRef = useRef<HTMLElement>(null);
  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(() => readStoredPanelWidths());
  const [draft, setDraft] = useState('');
  const [mentionQuery, setMentionQuery] = useState<FileMentionQuery | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<WorkspaceFileSuggestion[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | undefined>();
  const [modelOptions, setModelOptions] = useState<ModelOptions | null>(null);
  const [modelOptionsError, setModelOptionsError] = useState<string | undefined>();
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const runActive = sendingPrompt || runInFlight;
  const workspaceStyle = {
    '--session-sidebar-width': `${panelWidths.left}px`,
    '--session-side-width': `${panelWidths.right}px`,
  } as CSSProperties;

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(panelWidths));
  }, [panelWidths]);

  useEffect(() => {
    const element = conversationScrollRef.current;
    if (!element) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [selectedSessionId, sessionDetail?.messages.length, sessionDetailLoading, sessionDetailError]);

  useEffect(() => {
    let cancelled = false;
    void fetchModelOptions().then((options) => {
      if (!cancelled) {
        setModelOptions(options);
        setModelOptionsError(undefined);
      }
    }).catch((error) => {
      if (!cancelled) {
        setModelOptions(null);
        setModelOptionsError(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mentionQuery) {
      setMentionSuggestions([]);
      setMentionLoading(false);
      setMentionError(undefined);
      setActiveMentionIndex(0);
      return;
    }

    let cancelled = false;
    setMentionLoading(true);
    const timeout = window.setTimeout(() => {
      void fetchWorkspaceFileSuggestions(mentionQuery.query)
        .then((files) => {
          if (!cancelled) {
            setMentionSuggestions(files);
            setMentionError(undefined);
            setActiveMentionIndex(0);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setMentionSuggestions([]);
            setMentionError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setMentionLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [mentionQuery]);

  const updateDraft = (value: string, cursor: number | null) => {
    setDraft(value);
    setMentionQuery(findFileMentionQuery(value, cursor ?? value.length));
  };

  const insertMention = (suggestion: WorkspaceFileSuggestion) => {
    if (!mentionQuery) {
      return;
    }

    const nextDraft = `${draft.slice(0, mentionQuery.start)}@${suggestion.path} ${draft.slice(mentionQuery.end)}`;
    const nextCursor = mentionQuery.start + suggestion.path.length + 2;
    setDraft(nextDraft);
    setMentionQuery(null);
    setMentionSuggestions([]);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const startPanelResize = (edge: 'left' | 'right', event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const shellWidth = shellRef.current?.getBoundingClientRect().width;
    if (!shellWidth) {
      return;
    }

    const startX = event.clientX;
    const startWidths = panelWidths;
    const maxLeft = Math.min(LEFT_PANEL_MAX_WIDTH, shellWidth - startWidths.right - MAIN_PANEL_MIN_WIDTH - PANEL_HANDLE_WIDTH);
    const maxRight = Math.min(RIGHT_PANEL_MAX_WIDTH, shellWidth - startWidths.left - MAIN_PANEL_MIN_WIDTH - PANEL_HANDLE_WIDTH);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setPanelWidths({
        left:
          edge === 'left' ?
            clamp(startWidths.left + delta, LEFT_PANEL_MIN_WIDTH, maxLeft)
          : startWidths.left,
        right:
          edge === 'right' ?
            clamp(startWidths.right - delta, RIGHT_PANEL_MIN_WIDTH, maxRight)
          : startWidths.right,
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  useEffect(() => {
    if (!selectedSessionId) {
      setMobileView('list');
      return;
    }

    setMobileView((current) => current === 'list' ? 'chat' : current);
  }, [selectedSessionId]);

  const shellClassName = useMemo(() => {
    return className('workspace-shell', `mobile-view-${mobileView}`);
  }, [mobileView]);

  const selectSession = (sessionId: string) => {
    onSelectSession(sessionId);
    setMobileView('chat');
  };

  const selectTurn = (turnId: string) => {
    onSelectTurn(turnId);
    setMobileView('review');
    onInspectorTabChange('review');
  };

  const showSessionList = () => {
    setMobileView('list');
  };

  const showChatView = () => {
    setMobileView('chat');
  };

  const openSummaryInspector = () => {
    onInspectorTabChange('summary');
    setMobileView('review');
  };

  const openReviewInspector = () => {
    onInspectorTabChange('review');
    setMobileView('review');
  };

  const submitDraft = () => {
    const prompt = draft.trim();
    if (!prompt) {
      return;
    }
    setDraft('');
    void onSendPrompt(prompt);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery && (mentionSuggestions.length || mentionLoading)) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((index) => Math.min(index + 1, Math.max(mentionSuggestions.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        setMentionSuggestions([]);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && mentionSuggestions[activeMentionIndex]) {
        event.preventDefault();
        insertMention(mentionSuggestions[activeMentionIndex]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitDraft();
    }
  };

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
            actions={<button className="sidebar-action-button" type="button" disabled={creatingSession} onClick={() => void onCreateSession()}>{creatingSession ? 'Creating…' : '+ New session'}</button>}
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
        onOpenSummary={openSummaryInspector}
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
      <section className="mobile-session-screen mobile-session-review">
        <aside className="workspace-side mobile-pane">
          <MobileSessionNav
            activeView={inspectorTab === 'summary' ? 'info' : 'review'}
            title={sessionDetail?.name ?? activeSession?.name ?? 'Session'}
            subtitle={inspectorTab === 'summary' ? 'Session info' : 'Review evidence'}
            onBackToSessions={showSessionList}
            onOpenChat={showChatView}
            onOpenInfo={() => onInspectorTabChange('summary')}
            onOpenReview={() => onInspectorTabChange('review')}
          />

          <div className="side-scroll">
            {inspectorTab === 'summary' ?
              <>
                <SideSection title="Session context">
                  {sessionDetail ?
                    <div className="kv-list">
                      <div><span className="kv-key">session</span><span className="kv-value">{sessionDetail.id}</span></div>
                      <div><span className="kv-key">messages</span><span className="kv-value">{sessionDetail.messages.length}</span></div>
                      <div><span className="kv-key">turns</span><span className="kv-value">{sessionDetail.turns.length}</span></div>
                      <div><span className="kv-key">history tokens</span><span className="kv-value">{formatNumber(sessionDetail.context?.estimatedHistoryTokens)}</span></div>
                      <div><span className="kv-key">last run total</span><span className="kv-value">{formatNumber(sessionDetail.context?.lastRunTotalTokens)}</span></div>
                      <div><span className="kv-key">continue prompt</span><span className="kv-value">{sessionDetail.lastContinuePrompt ?? 'none'}</span></div>
                    </div>
                  : <EmptyState title="No session selected" body="Choose a session from the sidebar." />}
                </SideSection>

                <SideSection title="Turns">
                  {sessionDetail?.turns.length ?
                    <div className="stack-list compact">
                      {[...sessionDetail.turns].reverse().map((turn) => (
                        <TurnListButton
                          key={turn.id}
                          turn={turn}
                          active={turn.id === selectedTurnId}
                          onClick={() => selectTurn(turn.id)}
                        />
                      ))}
                    </div>
                  : <EmptyState title="No turns yet" body="Completed turns appear here with prompt, outcome, and trace summary." />}
                </SideSection>
              </>
            : <>
              <SideSection title="Diff / review excerpt">
                {turnReviewLoading ?
                  <EmptyState title="Loading review" body="Reading trace-backed review evidence for the selected turn." />
                : turnReviewError ?
                  <EmptyState title="Review load failed" body={turnReviewError} />
                : turnReview?.diffExcerpt ?
                  <CodeBlock>{turnReview.diffExcerpt}</CodeBlock>
                : <EmptyState title="No diff excerpt" body="This turn did not save git diff evidence. Review commands still appear below when available." />}
              </SideSection>

              <SideSection title="Review commands">
                <CommandList commands={turnReview?.reviewCommands ?? []} empty="No git review commands captured for this turn." />
              </SideSection>

              <SideSection title="Verification commands">
                <CommandList commands={turnReview?.verificationCommands ?? []} empty="No verification commands captured for this turn." />
              </SideSection>

              <SideSection title="Approvals and events">
                {turnReview?.approvals.length ?
                  <div className="stack-list compact">
                    {turnReview.approvals.map((approval, index) => (
                      <div className="detail-card" key={`${approval.tool}-${approval.timestamp ?? index}`}>
                        <p className="card-title">{approval.tool}</p>
                        <p className="muted">{approval.command ?? 'no command details'}</p>
                        <div className="pills">
                          <Pill tone={approval.approved ? 'good' : 'warn'}>{approval.approved ? 'approved' : 'rejected'}</Pill>
                        </div>
                        {approval.reason ? <p className="summary">{approval.reason}</p> : null}
                      </div>
                    ))}
                  </div>
                : selectedTurn?.events.length ?
                  <div className="event-list">
                    {selectedTurn.events.map((event, index) => <p key={`${selectedTurn.id}-${index}`} className="event-line">{event}</p>)}
                  </div>
                : <EmptyState title="No approvals or events" body="Turn-level approvals, tool review, or summarized events will appear here." />}
              </SideSection>
            </>}
          </div>
        </aside>
      </section>
    );
  }

  return (
    <section className={shellClassName} ref={shellRef} style={workspaceStyle} data-mobile-view={mobileView}>
      <aside className="workspace-sidebar">
        <WorkspaceSectionHeader
          title="Sessions"
          subtitle={`${sessions.length} saved conversation${sessions.length === 1 ? '' : 's'}`}
          actions={<button className="sidebar-action-button" type="button" disabled={creatingSession} onClick={() => void onCreateSession()}>{creatingSession ? 'Creating…' : '+ New session'}</button>}
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
              <button className="mobile-nav-button mobile-inspector-button" type="button" onClick={openSummaryInspector}>Summary</button>
              <button className="mobile-nav-button mobile-inspector-button" type="button" onClick={openReviewInspector}>Review</button>
              <label className="select-control">
                <span>model</span>
                <select
                  value={sessionDetail?.model ?? activeSession.model ?? ''}
                  disabled={runActive || !modelOptions}
                  onChange={(event) => void onUpdateSessionSettings({ model: event.target.value })}
                  title={modelOptionsError ? 'Model options unavailable. Restart the Heddle daemon if this route was just added.' : undefined}
                >
                  {modelOptions?.groups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.models.map((model) => <option key={model} value={model}>{model}</option>)}
                    </optgroup>
                  ))}
                  {!modelOptions ? <option value={sessionDetail?.model ?? activeSession.model ?? ''}>{modelOptionsError ? 'models unavailable' : sessionDetail?.model ?? activeSession.model ?? 'loading models'}</option> : null}
                </select>
              </label>
              <Pill>turns {activeSession.turnCount}</Pill>
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
            onKeyDown={(event) => {
              if (mentionQuery && (mentionSuggestions.length || mentionLoading)) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveMentionIndex((index) => Math.min(index + 1, Math.max(mentionSuggestions.length - 1, 0)));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveMentionIndex((index) => Math.max(index - 1, 0));
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMentionQuery(null);
                  setMentionSuggestions([]);
                  return;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && mentionSuggestions[activeMentionIndex]) {
                  event.preventDefault();
                  insertMention(mentionSuggestions[activeMentionIndex]);
                  return;
                }
              }

              if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                const prompt = draft.trim();
                if (!prompt) {
                  return;
                }
                setDraft('');
                void onSendPrompt(prompt);
              }
            }}
          />
          {mentionQuery ?
            <FileMentionMenu
              loading={mentionLoading}
              suggestions={mentionSuggestions}
              activeIndex={activeMentionIndex}
              error={mentionError}
              query={mentionQuery.query}
              onPick={insertMention}
            />
          : null}
          <div className="composer-footer">
            <div className="composer-status">
              <p className="muted">
                {sendPromptError ? sendPromptError
                : sessionNotice ? sessionNotice
                : runActive ? 'Run in progress. Continue is disabled until this run settles; Cancel interrupts the active run.'
                : sessionDetail?.lastContinuePrompt ? 'Enter sends. Option+Enter or Shift+Enter adds a new line.'
                : 'Enter sends. Option+Enter or Shift+Enter adds a new line.'}
              </p>
              <div className="pills compact-pills">
                <Pill tone={creatingSession ? 'warn' : runActive ? 'warn' : 'good'}>{creatingSession ? 'creating session' : runActive ? 'run active' : 'idle'}</Pill>
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
                onClick={() => {
                  const prompt = draft.trim();
                  if (!prompt) {
                    return;
                  }
                  setDraft('');
                  void onSendPrompt(prompt);
                }}
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

      <aside className="workspace-side">
        <div className="mobile-side-header">
          <button className="mobile-nav-button" type="button" onClick={showChatView}>← Chat</button>
        </div>
        <div className="side-tabs" role="tablist" aria-label="Session inspector">
          <button className={className(inspectorTab === 'summary' && 'active')} type="button" onClick={() => onInspectorTabChange('summary')}>Summary</button>
          <button className={className(inspectorTab === 'review' && 'active')} type="button" onClick={() => onInspectorTabChange('review')}>Review</button>
        </div>

        <div className="side-scroll">
          {inspectorTab === 'summary' ?
            <>
              <SideSection title="Session context">
                {sessionDetail ?
                  <div className="kv-list">
                    <div><span className="kv-key">session</span><span className="kv-value">{sessionDetail.id}</span></div>
                    <div><span className="kv-key">messages</span><span className="kv-value">{sessionDetail.messages.length}</span></div>
                    <div><span className="kv-key">turns</span><span className="kv-value">{sessionDetail.turns.length}</span></div>
                    <div><span className="kv-key">history tokens</span><span className="kv-value">{formatNumber(sessionDetail.context?.estimatedHistoryTokens)}</span></div>
                    <div><span className="kv-key">last run total</span><span className="kv-value">{formatNumber(sessionDetail.context?.lastRunTotalTokens)}</span></div>
                    <div><span className="kv-key">continue prompt</span><span className="kv-value">{sessionDetail.lastContinuePrompt ?? 'none'}</span></div>
                  </div>
                : <EmptyState title="No session selected" body="Choose a session from the sidebar." />}
              </SideSection>

              <SideSection title="Turns">
                {sessionDetail?.turns.length ?
                  <div className="stack-list compact">
                    {[...sessionDetail.turns].reverse().map((turn) => (
                      <TurnListButton
                        key={turn.id}
                        turn={turn}
                        active={turn.id === selectedTurnId}
                        onClick={() => selectTurn(turn.id)}
                      />
                    ))}
                  </div>
                : <EmptyState title="No turns yet" body="Completed turns appear here with prompt, outcome, and trace summary." />}
              </SideSection>
            </>
          : <>
            <SideSection title="Diff / review excerpt">
              {turnReviewLoading ?
                <EmptyState title="Loading review" body="Reading trace-backed review evidence for the selected turn." />
              : turnReviewError ?
                <EmptyState title="Review load failed" body={turnReviewError} />
              : turnReview?.diffExcerpt ?
                <CodeBlock>{turnReview.diffExcerpt}</CodeBlock>
              : <EmptyState title="No diff excerpt" body="This turn did not save git diff evidence. Review commands still appear below when available." />}
            </SideSection>

            <SideSection title="Review commands">
              <CommandList commands={turnReview?.reviewCommands ?? []} empty="No git review commands captured for this turn." />
            </SideSection>

            <SideSection title="Verification commands">
              <CommandList commands={turnReview?.verificationCommands ?? []} empty="No verification commands captured for this turn." />
            </SideSection>

            <SideSection title="Approvals and events">
              {turnReview?.approvals.length ?
                <div className="stack-list compact">
                  {turnReview.approvals.map((approval, index) => (
                    <div className="detail-card" key={`${approval.tool}-${approval.timestamp ?? index}`}>
                      <p className="card-title">{approval.tool}</p>
                      <p className="muted">{approval.command ?? 'no command details'}</p>
                      <div className="pills">
                        <Pill tone={approval.approved ? 'good' : 'warn'}>{approval.approved ? 'approved' : 'rejected'}</Pill>
                      </div>
                      {approval.reason ? <p className="summary">{approval.reason}</p> : null}
                    </div>
                  ))}
                </div>
              : selectedTurn?.events.length ?
                <div className="event-list">
                  {selectedTurn.events.map((event, index) => <p key={`${selectedTurn.id}-${index}`} className="event-line">{event}</p>)}
                </div>
              : <EmptyState title="No approvals or events" body="Turn-level approvals, tool review, or summarized events will appear here." />}
            </SideSection>
          </>}
        </div>
      </aside>
    </section>
  );
}

type FileMentionQuery = {
  query: string;
  start: number;
  end: number;
};

type PanelWidths = {
  left: number;
  right: number;
};

type MobileView = 'list' | 'chat' | 'review';

function readStoredPanelWidths(): PanelWidths {
  try {
    const stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!stored) {
      return { left: 288, right: 344 };
    }

    const parsed = JSON.parse(stored) as Partial<PanelWidths>;
    return {
      left: clamp(typeof parsed.left === 'number' ? parsed.left : 288, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH),
      right: clamp(typeof parsed.right === 'number' ? parsed.right : 344, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH),
    };
  } catch {
    return { left: 288, right: 344 };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
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

function findFileMentionQuery(value: string, cursor: number): FileMentionQuery | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }

  const prefix = match[1] ?? '';
  const query = match[2] ?? '';
  const start = match.index + prefix.length;
  return {
    query,
    start,
    end: cursor,
  };
}

const ConversationMessage = memo(function ConversationMessage({ message }: { message: Exclude<ChatSessionDetail, null>['messages'][number] }) {
  const isWorking = message.role === 'assistant' && (message.isPending || message.isStreaming);
  const toolResult = message.role === 'assistant' ? parseToolResultMessage(message.text) : undefined;
  return (
    <article className={className('message', message.role === 'user' ? 'user' : 'assistant', toolResult && 'tool-result', isWorking && 'working')}>
      <div className="message-header">
        <span>{message.role === 'user' ? 'You' : toolResult ? 'Tool result' : 'Heddle'}</span>
        <div className="pills compact-pills">
          {toolResult ? <Pill tone={toolResult.ok === false ? 'bad' : 'good'}>{toolResult.tool}</Pill> : null}
          {message.isPending ? <Pill tone="warn">working</Pill> : null}
          {message.isStreaming ? <Pill>live</Pill> : null}
        </div>
      </div>
      <div className={className('message-body', message.role === 'assistant' && 'markdown-body')}>
        {toolResult ? <ToolResultBody result={toolResult} />
        : message.role === 'assistant' ? renderSimpleMarkdown(message.text)
        : message.text}
      </div>
    </article>
  );
});

type ParsedToolResult = {
  tool: string;
  ok?: boolean;
  command?: string;
  output?: unknown;
  error?: string;
};

function ToolResultBody({ result }: { result: ParsedToolResult }) {
  const output = formatToolOutput(result.output);
  return (
    <div className="tool-result-body">
      <div className="tool-result-meta">
        <Pill tone={result.ok === false ? 'bad' : 'good'}>{result.ok === false ? 'failed' : 'completed'}</Pill>
        {result.command ? <span className="tool-command">{result.command}</span> : null}
      </div>
      {result.error ? <p className="tool-error">{result.error}</p> : null}
      {output ? <pre className="tool-output">{output}</pre> : <p className="muted">No visible output.</p>}
    </div>
  );
}

function parseToolResultMessage(text: string): ParsedToolResult | undefined {
  const match = text.match(/^([a-z][a-z0-9_]*):\s*([\s\S]*)$/);
  if (!match) {
    return undefined;
  }

  const [, tool, rawPayload] = match;
  if (!isKnownToolName(tool)) {
    return undefined;
  }

  const payload = parseJsonPayload(rawPayload.trim());
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { tool, output: rawPayload.trim() };
  }

  const record = payload as Record<string, unknown>;
  const output = record.output;
  const outputRecord = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : undefined;
  return {
    tool,
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    command: typeof outputRecord?.command === 'string' ? outputRecord.command : undefined,
    output: outputRecord?.stdout ?? outputRecord?.output ?? output,
    error: typeof record.error === 'string' ? record.error : typeof outputRecord?.stderr === 'string' && !outputRecord.stdout ? outputRecord.stderr : undefined,
  };
}

function parseJsonPayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function formatToolOutput(output: unknown): string | undefined {
  if (output === undefined || output === null) {
    return undefined;
  }

  if (typeof output === 'string') {
    return output.trim() || undefined;
  }

  return JSON.stringify(output, null, 2);
}

function isKnownToolName(value: string): boolean {
  return [
    'edit_file',
    'edit_memory_note',
    'list_files',
    'read_file',
    'report_state',
    'run_shell_inspect',
    'run_shell_mutate',
    'search_files',
    'search_memory_notes',
    'update_plan',
    'view_image',
    'web_search',
  ].includes(value);
}

function renderSimpleMarkdown(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: Array<{ checked?: boolean; content: string }> = [];
  let orderedItems: string[] = [];
  let codeFence: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    nodes.push(<p key={`p-${nodes.length}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    nodes.push(
      <ul key={`ul-${nodes.length}`}>
        {listItems.map((item, index) => (
          <li key={index}>
            {typeof item.checked === 'boolean' ?
              <>
                <input type="checkbox" checked={item.checked} readOnly disabled />{' '}
              </>
            : null}
            {renderInlineMarkdown(item.content)}
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  const flushOrdered = () => {
    if (!orderedItems.length) {
      return;
    }
    nodes.push(
      <ol key={`ol-${nodes.length}`}>
        {orderedItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </ol>,
    );
    orderedItems = [];
  };

  const flushCodeFence = () => {
    if (!codeFence) {
      return;
    }
    nodes.push(<pre key={`code-${nodes.length}`} className="code-block"><code>{codeFence.join('\n')}</code></pre>);
    codeFence = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      flushOrdered();
      if (codeFence) {
        flushCodeFence();
      } else {
        codeFence = [];
      }
      continue;
    }

    if (codeFence) {
      codeFence.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushOrdered();
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2] ?? '');
      if (level === 1) {
        nodes.push(<h1 key={`h1-${nodes.length}`}>{content}</h1>);
      } else if (level === 2) {
        nodes.push(<h2 key={`h2-${nodes.length}`}>{content}</h2>);
      } else if (level === 3) {
        nodes.push(<h3 key={`h3-${nodes.length}`}>{content}</h3>);
      } else {
        nodes.push(<h4 key={`h4-${nodes.length}`}>{content}</h4>);
      }
      continue;
    }

    const checklist = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (checklist) {
      flushParagraph();
      flushOrdered();
      listItems.push({ checked: checklist[1].toLowerCase() === 'x', content: checklist[2] ?? '' });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      flushOrdered();
      listItems.push({ content: bullet[1] ?? '' });
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      flushList();
      orderedItems.push(ordered[1] ?? '');
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushOrdered();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushOrdered();
  flushCodeFence();

  return nodes.length ? nodes : markdown;
}

function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(<code key={`code-${match.index}`} className="inline-code">{match[1]}</code>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}
