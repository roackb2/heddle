import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState, WorkspaceChanges, WorkspaceFileDiff } from '../../../../lib/api';
import { EmptyState, WorkspaceSectionHeader } from '../../components/common';
import { ConversationMessage } from '../../components/ConversationMessage';
import { SessionListButton } from '../../components/lists';
import { MobileChatScreen } from '../../mobile/MobileChatScreen';
import { MobileReviewScreen } from '../../mobile/MobileReviewScreen';
import { FullDiffDialog, type ExpandedDiff } from '../SessionReviewPanel';
import type { SessionTurn } from '../SessionsScreen';

type MobileView = 'list' | 'chat' | 'review';

export function SessionsMobileLayout({
  mobileView,
  sessions,
  activeSession,
  sessionDetail,
  sessionDetailLoading,
  sessionDetailError,
  selectedSessionId,
  selectedTurnId,
  selectedTurn,
  turnReview,
  turnReviewLoading,
  turnReviewError,
  runActive,
  runInFlight,
  memoryUpdating,
  authStatus,
  sendPromptError,
  sessionNotice,
  draft,
  pendingApproval,
  conversationScrollRef,
  textareaRef,
  mentionMenu,
  workspaceChanges,
  workspaceChangesLoading,
  workspaceChangesError,
  workspaceFileDiff,
  workspaceFileDiffsByPath,
  workspaceFileDiffLoading,
  workspaceFileDiffError,
  selectedTurnPatchIsStale,
  expandedDiff,
  creatingSession,
  onCreateSession,
  onSelectSession,
  onSelectTurn,
  onDraftChange,
  onComposerKeyDown,
  onBackToSessions,
  onOpenReview,
  onSubmitPrompt,
  onContinueSession,
  onCancelSessionRun,
  onResolveApproval,
  onSelectWorkspaceFile,
  onRefreshWorkspaceReview,
  onOpenDiff,
  onOpenChat,
  onCloseDiff,
}: {
  mobileView: MobileView;
  sessions: ControlPlaneState['sessions'];
  activeSession?: ControlPlaneState['sessions'][number];
  sessionDetail: ChatSessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError?: string;
  selectedSessionId?: string;
  selectedTurnId?: string;
  selectedTurn?: SessionTurn;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  runActive: boolean;
  runInFlight: boolean;
  memoryUpdating: boolean;
  authStatus?: string;
  sendPromptError?: string;
  sessionNotice?: string;
  draft: string;
  pendingApproval: { tool: string; callId: string; input?: unknown; requestedAt: string } | null;
  conversationScrollRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mentionMenu: ReactNode;
  workspaceChanges: WorkspaceChanges | null;
  workspaceChangesLoading: boolean;
  workspaceChangesError?: string;
  workspaceFileDiff: WorkspaceFileDiff | null;
  workspaceFileDiffsByPath: Record<string, WorkspaceFileDiff>;
  workspaceFileDiffLoading: boolean;
  workspaceFileDiffError?: string;
  selectedTurnPatchIsStale: boolean;
  expandedDiff: ExpandedDiff | null;
  creatingSession: boolean;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onSelectTurn: (turnId: string) => void;
  onDraftChange: (value: string, cursor: number | null) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBackToSessions: () => void;
  onOpenReview: () => void;
  onSubmitPrompt: () => void;
  onContinueSession: () => Promise<void>;
  onCancelSessionRun: () => Promise<void>;
  onResolveApproval: (approved: boolean) => Promise<void>;
  onSelectWorkspaceFile: (path: string) => void;
  onRefreshWorkspaceReview: () => void;
  onOpenDiff: (diff: ExpandedDiff) => void;
  onOpenChat: () => void;
  onCloseDiff: () => void;
}) {
  if (mobileView === 'list') {
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
                    onClick={() => onSelectSession(session.id)}
                  />
                ))}
              </div>
            : <div className="sidebar-empty-state"><EmptyState title="No sessions" body="Create a new web session to start a fresh conversation in the browser." /></div>}
          </div>
        </aside>
      </section>
    );
  }

  if (mobileView === 'chat') {
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
        onDraftChange={onDraftChange}
        onComposerKeyDown={onComposerKeyDown}
        onBackToSessions={onBackToSessions}
        onOpenReview={onOpenReview}
        onSubmitPrompt={onSubmitPrompt}
        onContinueSession={() => void onContinueSession()}
        onCancelSessionRun={() => void onCancelSessionRun()}
        onResolveApproval={(approved) => void onResolveApproval(approved)}
      />
    );
  }

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
        onSelectWorkspaceFile={onSelectWorkspaceFile}
        onRefreshWorkspaceReview={onRefreshWorkspaceReview}
        selectedTurnPatchIsStale={selectedTurnPatchIsStale}
        onOpenDiff={onOpenDiff}
        onBackToSessions={onBackToSessions}
        onOpenChat={onOpenChat}
        onSelectTurn={onSelectTurn}
      />
      <FullDiffDialog diff={expandedDiff} onClose={onCloseDiff} />
    </>
  );
}
