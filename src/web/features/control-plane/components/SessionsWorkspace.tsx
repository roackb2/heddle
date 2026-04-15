import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState } from '../../../lib/api';
import { formatDate, formatNumber, toneFor, className } from '../utils';
import { CodeBlock, EmptyState, Pill, SideSection, WorkspaceSectionHeader } from './common';
import { CommandList, SessionListButton, TurnListButton } from './lists';

export type SessionTurn = Exclude<ChatSessionDetail, null>['turns'][number];

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
  inspectorTab,
  onInspectorTabChange,
}: SessionsWorkspaceProps) {
  return (
    <section className="workspace-shell">
      <aside className="workspace-sidebar">
        <WorkspaceSectionHeader
          title="Sessions"
          subtitle={`${sessions.length} saved conversation${sessions.length === 1 ? '' : 's'}`}
        />
        <div className="sidebar-scroll">
          {sessions.length ?
            sessions.map((session) => (
              <SessionListButton
                key={session.id}
                session={session}
                active={session.id === selectedSessionId}
                onClick={() => onSelectSession(session.id)}
              />
            ))
          : <EmptyState title="No sessions" body="Run Heddle chat first to create session state." />}
        </div>
      </aside>

      <section className="workspace-main">
        <WorkspaceSectionHeader
          title={sessionDetail?.name ?? activeSession?.name ?? 'Chat session'}
          subtitle={activeSession ? `${activeSession.id} · updated ${formatDate(activeSession.updatedAt)}` : 'Pick a session to inspect its conversation.'}
          actions={activeSession ? (
            <div className="pills">
              <Pill>{activeSession.model ?? 'model unset'}</Pill>
              <Pill>turns {activeSession.turnCount}</Pill>
              <Pill tone={activeSession.driftEnabled ? 'good' : undefined}>{activeSession.driftEnabled ? 'drift on' : 'drift off'}</Pill>
            </div>
          ) : undefined}
        />

        <div className="conversation-scroll">
          {sessionDetailLoading ?
            <EmptyState title="Loading session" body="Fetching full conversation state from saved Heddle session storage." />
          : sessionDetailError ?
            <EmptyState title="Session load failed" body={sessionDetailError} />
          : sessionDetail && sessionDetail.messages.length ?
            sessionDetail.messages.map((message) => <ConversationMessage key={message.id} message={message} />)
          : <EmptyState title="No conversation available" body="This session does not have any saved chat messages yet." />}
        </div>

        <div className="composer-shell">
          <textarea disabled placeholder="Send-message wiring comes next. This shell is here to lock in the workstation layout first." />
          <div className="composer-footer">
            <p className="muted">Read-only for now. The next API slice should wire send/continue into this exact shell.</p>
            <button className="primary-button" type="button" disabled>Send</button>
          </div>
        </div>
      </section>

      <aside className="workspace-side">
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
                        onClick={() => onSelectTurn(turn.id)}
                      />
                    ))}
                  </div>
                : <EmptyState title="No turns yet" body="Completed turns appear here with prompt, outcome, and trace summary." />}
              </SideSection>
            </>
          : <>
            <SideSection title="Selected turn">
              {selectedTurn ?
                <div className="detail-card">
                  <p className="card-title">{selectedTurn.prompt}</p>
                  <div className="pills">
                    <Pill tone={toneFor(selectedTurn.outcome)}>{selectedTurn.outcome}</Pill>
                    <Pill>steps {selectedTurn.steps}</Pill>
                  </div>
                  <p className="summary">{selectedTurn.summary}</p>
                </div>
              : <EmptyState title="No turn selected" body="Pick a turn to inspect review evidence and trace-derived details." />}
            </SideSection>

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
                  {selectedTurn.events.map((event) => <p key={event} className="event-line">{event}</p>)}
                </div>
              : <EmptyState title="No approvals or events" body="Turn-level approvals, tool review, or summarized events will appear here." />}
            </SideSection>
          </>}
        </div>
      </aside>
    </section>
  );
}

function ConversationMessage({ message }: { message: Exclude<ChatSessionDetail, null>['messages'][number] }) {
  return (
    <article className={className('message', message.role === 'user' ? 'user' : 'assistant')}>
      <div className="message-header">
        <span>{message.role === 'user' ? 'You' : 'Heddle'}</span>
        <div className="pills compact-pills">
          {message.isPending ? <Pill tone="warn">queued</Pill> : null}
          {message.isStreaming ? <Pill>streaming</Pill> : null}
        </div>
      </div>
      <div className="message-body">{message.text}</div>
    </article>
  );
}
