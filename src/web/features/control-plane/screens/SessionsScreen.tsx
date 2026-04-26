import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import {
  fetchModelOptions,
  fetchWorkspaceChanges,
  fetchWorkspaceFileDiff,
  fetchWorkspaceFileSuggestions,
  type ChatSessionDetail,
  type ChatTurnReview,
  type ControlPlaneState,
  type ModelOptions,
  type WorkspaceChanges,
  type WorkspaceFileDiff,
  type WorkspaceFileSuggestion,
} from '../../../lib/api';
import { formatDate, className } from '../utils';
import { CodeBlock, EmptyState, Pill, SideSection, WorkspaceSectionHeader } from '../components/common';
import { DiffViewer } from '../components/DiffViewer';
import { CommandList, SessionListButton, TurnListButton } from '../components/lists';
import { ConversationMessage } from '../components/ConversationMessage';
import { MobileChatScreen } from '../mobile/MobileChatScreen';
import { MobileReviewScreen } from '../mobile/MobileReviewScreen';
import { Button } from '../../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';

export type SessionTurn = Exclude<ChatSessionDetail, null>['turns'][number];

const PANEL_WIDTH_STORAGE_KEY = 'heddle.controlPlane.sessionPanelWidths';
const PANEL_HANDLE_WIDTH = 12;
const MAIN_PANEL_MIN_WIDTH = 420;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 620;

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
  const [selectedReviewFilePath, setSelectedReviewFilePath] = useState<string | undefined>();
  const [workspaceChanges, setWorkspaceChanges] = useState<WorkspaceChanges | null>(null);
  const [workspaceChangesLoading, setWorkspaceChangesLoading] = useState(false);
  const [workspaceChangesError, setWorkspaceChangesError] = useState<string | undefined>();
  const [selectedWorkspaceFilePath, setSelectedWorkspaceFilePath] = useState<string | undefined>();
  const [workspaceFileDiff, setWorkspaceFileDiff] = useState<WorkspaceFileDiff | null>(null);
  const [workspaceFileDiffLoading, setWorkspaceFileDiffLoading] = useState(false);
  const [workspaceFileDiffError, setWorkspaceFileDiffError] = useState<string | undefined>();
  const [workspaceReviewRefreshKey, setWorkspaceReviewRefreshKey] = useState(0);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('current');
  const [expandedDiff, setExpandedDiff] = useState<ExpandedDiff | null>(null);
  const runActive = sendingPrompt || runInFlight;
  const compactionStatus = sessionDetail?.context?.compactionStatus ?? activeSession?.context?.compactionStatus;
  const selectedReviewFile =
    turnReview?.files.find((file) => file.path === selectedReviewFilePath) ?? turnReview?.files[0];
  const selectedWorkspaceFile =
    workspaceChanges?.files.find((file) => file.path === selectedWorkspaceFilePath) ?? workspaceChanges?.files[0];
  const selectedTurnPatchIsStale = Boolean(
    selectedReviewFile?.path
    && selectedWorkspaceFile?.path === selectedReviewFile.path
    && selectedReviewFile.patch
    && workspaceFileDiff?.patch
    && normalizePatchForComparison(selectedReviewFile.patch) !== normalizePatchForComparison(workspaceFileDiff.patch),
  );
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
    setSelectedReviewFilePath(turnReview?.files[0]?.path);
  }, [selectedTurnId, turnReview?.traceFile]);

  useEffect(() => {
    let cancelled = false;
    setWorkspaceChangesLoading(true);
    async function refreshWorkspaceChanges() {
      try {
        const next = await fetchWorkspaceChanges();
        if (!cancelled) {
          setWorkspaceChanges(next);
          setWorkspaceChangesError(undefined);
          setSelectedWorkspaceFilePath((current) => (
            current && next.files.some((file) => file.path === current) ? current : next.files[0]?.path
          ));
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceChangesError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceChangesLoading(false);
        }
      }
    }

    void refreshWorkspaceChanges();

    return () => {
      cancelled = true;
    };
  }, [runActive, sessionDetail?.updatedAt, workspaceReviewRefreshKey]);

  useEffect(() => {
    if (!selectedWorkspaceFile?.path) {
      setWorkspaceFileDiff(null);
      setWorkspaceFileDiffError(undefined);
      return;
    }

    const filePath = selectedWorkspaceFile.path;
    let cancelled = false;
    setWorkspaceFileDiffLoading(true);
    async function refreshWorkspaceFileDiff() {
      try {
        const next = await fetchWorkspaceFileDiff(filePath);
        if (!cancelled) {
          setWorkspaceFileDiff(next);
          setWorkspaceFileDiffError(undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceFileDiffError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceFileDiffLoading(false);
        }
      }
    }

    void refreshWorkspaceFileDiff();

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceFile?.path, workspaceReviewRefreshKey]);

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
  };

  const showSessionList = () => {
    setMobileView('list');
  };

  const showChatView = () => {
    setMobileView('chat');
  };

  const openReviewInspector = () => {
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

    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }

    if (typeof window !== 'undefined' && window.innerWidth <= 760) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        submitDraft();
      }
      return;
    }

    if (!event.shiftKey && !event.altKey) {
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
        memoryUpdating={memoryUpdating}
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
          selectedWorkspaceFile={selectedWorkspaceFile}
          workspaceFileDiff={workspaceFileDiff}
          workspaceFileDiffLoading={workspaceFileDiffLoading}
          workspaceFileDiffError={workspaceFileDiffError}
          onSelectWorkspaceFile={setSelectedWorkspaceFilePath}
          onRefreshWorkspaceReview={() => setWorkspaceReviewRefreshKey((current) => current + 1)}
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
        <div className="side-scroll">
          <nav className="side-tabs review-mode-tabs" role="tablist" aria-label="Review mode">
            <button className={className(reviewMode === 'current' && 'active')} type="button" onClick={() => setReviewMode('current')}>Current</button>
            <button className={className(reviewMode === 'turn' && 'active')} type="button" onClick={() => setReviewMode('turn')}>Turn history</button>
            <button className={className(reviewMode === 'evidence' && 'active')} type="button" onClick={() => setReviewMode('evidence')}>Evidence</button>
          </nav>

          {reviewMode === 'current' ?
            <CurrentWorkspaceReviewSection
              workspaceChanges={workspaceChanges}
              workspaceChangesLoading={workspaceChangesLoading}
              workspaceChangesError={workspaceChangesError}
              selectedWorkspaceFile={selectedWorkspaceFile}
              workspaceFileDiff={workspaceFileDiff}
              workspaceFileDiffLoading={workspaceFileDiffLoading}
              workspaceFileDiffError={workspaceFileDiffError}
              selectedTurnPatchIsStale={selectedTurnPatchIsStale}
              onSelectWorkspaceFile={setSelectedWorkspaceFilePath}
              onRefresh={() => setWorkspaceReviewRefreshKey((current) => current + 1)}
              onOpenDiff={setExpandedDiff}
            />
          : reviewMode === 'turn' ?
            <HistoricalTurnReviewSection
              sessionDetail={sessionDetail}
              selectedTurnId={selectedTurnId}
              onSelectTurn={selectTurn}
              turnReview={turnReview}
              turnReviewLoading={turnReviewLoading}
              turnReviewError={turnReviewError}
              selectedReviewFile={selectedReviewFile}
              onSelectReviewFile={setSelectedReviewFilePath}
              onOpenDiff={setExpandedDiff}
            />
          : <ReviewEvidenceSection turnReview={turnReview} selectedTurn={selectedTurn} />}
        </div>
      </aside>
      <FullDiffDialog diff={expandedDiff} onClose={() => setExpandedDiff(null)} />
    </section>
  );
}

function normalizePatchForComparison(patch: string): string {
  return patch.trim().replace(/\r\n/g, '\n');
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
type ReviewMode = 'current' | 'turn' | 'evidence';
export type ExpandedDiff = {
  title: string;
  subtitle: string;
  diff?: WorkspaceFileDiff['diff'];
  patch?: string;
  fallbackTitle: string;
};

type WorkspaceChangedFileValue = WorkspaceChanges['files'][number];

function CurrentWorkspaceReviewSection({
  workspaceChanges,
  workspaceChangesLoading,
  workspaceChangesError,
  selectedWorkspaceFile,
  workspaceFileDiff,
  workspaceFileDiffLoading,
  workspaceFileDiffError,
  selectedTurnPatchIsStale,
  onSelectWorkspaceFile,
  onRefresh,
  onOpenDiff,
}: {
  workspaceChanges: WorkspaceChanges | null;
  workspaceChangesLoading: boolean;
  workspaceChangesError?: string;
  selectedWorkspaceFile?: WorkspaceChangedFileValue;
  workspaceFileDiff: WorkspaceFileDiff | null;
  workspaceFileDiffLoading: boolean;
  workspaceFileDiffError?: string;
  selectedTurnPatchIsStale: boolean;
  onSelectWorkspaceFile: (path: string) => void;
  onRefresh: () => void;
  onOpenDiff: (diff: ExpandedDiff) => void;
}) {
  const diffTitle = selectedWorkspaceFile?.path ?? workspaceFileDiff?.path ?? 'Workspace diff';
  return (
    <SideSection
      title="Current workspace changes"
      actions={
        <div className="review-section-actions">
          {selectedTurnPatchIsStale ? <StalePatchIndicator /> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={workspaceChangesLoading || workspaceFileDiffLoading}
          >
            Refresh
          </Button>
        </div>
      }
    >
      {workspaceChangesLoading ?
        <EmptyState title="Loading workspace diff" body="Reading current Git changes from the active workspace." />
      : workspaceChangesError ?
        <EmptyState title="Workspace diff failed" body={workspaceChangesError} />
      : workspaceChanges?.vcs === 'none' ?
        <EmptyState title="Not a git workspace" body={workspaceChanges.error ?? 'Current workspace changes require a Git-backed project.'} />
      : workspaceChanges?.files.length ?
        <div className="detail-stack compact-stack">
          <ChangedFilePicker
            files={workspaceChanges.files}
            selectedPath={selectedWorkspaceFile?.path}
            sourceLabel="current git"
            onSelect={onSelectWorkspaceFile}
          />
          {workspaceFileDiffLoading ?
            <EmptyState title="Loading file diff" body="Reading the selected file patch." />
          : workspaceFileDiffError ?
            <EmptyState title="File diff failed" body={workspaceFileDiffError} />
          : workspaceFileDiff?.error ?
            <EmptyState title="File diff unavailable" body={workspaceFileDiff.error} />
          : workspaceFileDiff?.patch ?
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onOpenDiff({
                  title: diffTitle,
                  subtitle: 'Current workspace diff',
                  diff: workspaceFileDiff.diff,
                  patch: workspaceFileDiff.patch,
                  fallbackTitle: 'Raw workspace patch',
                })}
              >
                Open full diff
              </Button>
              <DiffViewer diff={workspaceFileDiff.diff} patch={workspaceFileDiff.patch} fallbackTitle="Raw workspace patch" />
            </>
          : <EmptyState title="No patch available" body="Git reports this file as changed, but no patch text is available for it." />}
        </div>
      : <EmptyState title="Clean workspace" body="Git does not report current project file changes." />}
    </SideSection>
  );
}

function HistoricalTurnReviewSection({
  sessionDetail,
  selectedTurnId,
  onSelectTurn,
  turnReview,
  turnReviewLoading,
  turnReviewError,
  selectedReviewFile,
  onSelectReviewFile,
  onOpenDiff,
}: {
  sessionDetail: ChatSessionDetail | null;
  selectedTurnId?: string;
  onSelectTurn: (turnId: string) => void;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  selectedReviewFile?: NonNullable<ChatTurnReview>['files'][number];
  onSelectReviewFile: (path: string) => void;
  onOpenDiff: (diff: ExpandedDiff) => void;
}) {
  return (
    <SideSection title="Captured turn diff">
      {sessionDetail?.turns.length ?
        <div className="stack-list compact review-turn-picker">
          {[...sessionDetail.turns].reverse().map((turn) => (
            <TurnListButton
              key={turn.id}
              turn={turn}
              active={turn.id === selectedTurnId}
              onClick={() => onSelectTurn(turn.id)}
            />
          ))}
        </div>
      : null}

      {turnReviewLoading ?
        <EmptyState title="Loading review" body="Reading trace-backed review evidence for the selected turn." />
      : turnReviewError ?
        <EmptyState title="Review load failed" body={turnReviewError} />
      : turnReview?.files.length ?
        <div className="detail-stack compact-stack">
          <ChangedFilePicker
            files={turnReview.files}
            selectedPath={selectedReviewFile?.path}
            onSelect={onSelectReviewFile}
          />
          {selectedReviewFile?.patch ?
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onOpenDiff({
                  title: selectedReviewFile.path,
                  subtitle: 'Captured turn diff',
                  diff: selectedReviewFile.diff,
                  patch: selectedReviewFile.patch,
                  fallbackTitle: 'Raw turn patch',
                })}
              >
                Open full diff
              </Button>
              <DiffViewer diff={selectedReviewFile.diff} patch={selectedReviewFile.patch} fallbackTitle="Raw turn patch" />
            </>
          : <EmptyState title="No patch captured" body="This file was changed, but the turn did not capture patch text for it." />}
        </div>
      : turnReview?.diffExcerpt ?
        <CodeBlock>{turnReview.diffExcerpt}</CodeBlock>
      : <EmptyState title="No captured diff" body="This selected turn did not save file-level diff evidence. Check Evidence for commands and approvals." />}
    </SideSection>
  );
}

function StalePatchIndicator() {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="stale-diff-button" type="button" aria-label="Current workspace differs from captured turn">
            i
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-64">
          The selected file also has trace-backed turn evidence, but the current Git patch is different. Treat Current as live workspace state.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FullDiffDialog({ diff, onClose }: { diff: ExpandedDiff | null; onClose: () => void }) {
  if (!diff) {
    return null;
  }

  return (
    <div className="diff-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="diff-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${diff.subtitle}: ${diff.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="diff-dialog-header">
          <div className="min-w-0">
            <p className="topbar-eyebrow">Diff review</p>
            <h2>{diff.title}</h2>
            <p className="muted">{diff.subtitle}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </header>
        <div className="diff-dialog-body">
          <DiffViewer diff={diff.diff} patch={diff.patch} fallbackTitle={diff.fallbackTitle} />
        </div>
      </section>
    </div>
  );
}

function ReviewEvidenceSection({ turnReview, selectedTurn }: { turnReview: ChatTurnReview | null; selectedTurn?: SessionTurn }) {
  return (
    <>
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
    </>
  );
}

function ChangedFilePicker({
  files,
  selectedPath,
  sourceLabel,
  onSelect,
}: {
  files: Array<WorkspaceChangedFileValue | NonNullable<ChatTurnReview>['files'][number]>;
  selectedPath?: string;
  sourceLabel?: string;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="stack-list compact">
      {files.map((file) => (
        <button
          key={`${'source' in file ? file.source : 'workspace'}-${file.path}`}
          type="button"
          className={className('list-button compact-button', selectedPath === file.path && 'active')}
          onClick={() => onSelect(file.path)}
        >
          <div className="list-button-header">
            <strong>{file.path}</strong>
            <span>{file.status}</span>
          </div>
          <div className="pills compact-pills">
            {'source' in file ? <Pill>{file.source}</Pill> : <Pill>{sourceLabel ?? 'current git'}</Pill>}
            {'additions' in file && (file.additions !== undefined || file.deletions !== undefined) ?
              <Pill tone="good">+{file.additions ?? 0} / -{file.deletions ?? 0}</Pill>
            : null}
            {'binary' in file && file.binary ? <Pill tone="warn">binary</Pill> : null}
            {'truncated' in file && file.truncated ? <Pill tone="warn">truncated</Pill> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

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
