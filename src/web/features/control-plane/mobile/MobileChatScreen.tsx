import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { ChatSessionDetail, ControlPlaneState } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { formatDate } from '../utils';

type ChatMessage = Exclude<ChatSessionDetail, null>['messages'][number];

type MobileChatScreenProps = {
  activeSession?: ControlPlaneState['sessions'][number];
  sessionDetail: ChatSessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError?: string;
  selectedSessionId?: string;
  runActive: boolean;
  runInFlight: boolean;
  sendPromptError?: string;
  sessionNotice?: string;
  draft: string;
  pendingApproval: { tool: string; callId: string; input?: unknown; requestedAt: string } | null;
  conversationScrollRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mentionMenu?: ReactNode;
  renderMessage: (message: ChatMessage) => ReactNode;
  onDraftChange: (value: string, cursor: number | null) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBackToSessions: () => void;
  onOpenSummary: () => void;
  onOpenReview: () => void;
  onSubmitPrompt: () => void;
  onContinueSession: () => void;
  onCancelSessionRun: () => void;
  onResolveApproval: (approved: boolean) => void;
};

export function MobileChatScreen({
  activeSession,
  sessionDetail,
  sessionDetailLoading,
  sessionDetailError,
  selectedSessionId,
  runActive,
  runInFlight,
  sendPromptError,
  sessionNotice,
  draft,
  pendingApproval,
  conversationScrollRef,
  textareaRef,
  mentionMenu,
  renderMessage,
  onDraftChange,
  onComposerKeyDown,
  onBackToSessions,
  onOpenSummary,
  onOpenReview,
  onSubmitPrompt,
  onContinueSession,
  onCancelSessionRun,
  onResolveApproval,
}: MobileChatScreenProps) {
  const canSend = Boolean(selectedSessionId && !runActive && draft.trim());
  const canContinue = Boolean(selectedSessionId && !runActive && sessionDetail?.lastContinuePrompt);
  const title = sessionDetail?.name ?? activeSession?.name ?? 'Chat session';

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onBackToSessions}>
            Sessions
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-sm font-semibold leading-5 tracking-normal">{title}</h2>
            <p className="m-0 truncate text-xs leading-4 text-muted-foreground">
              {activeSession ? `updated ${formatDate(activeSession.updatedAt)}` : 'Pick a session'}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onOpenSummary}>
            Info
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={onOpenReview}>
            Review
          </Button>
        </div>
      </header>

      <div ref={conversationScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex min-h-full flex-col justify-end gap-3">
          {sessionDetailLoading ?
            <MobileEmptyState title="Loading session" body="Fetching conversation state." />
          : sessionDetailError ?
            <MobileEmptyState title="Session load failed" body={sessionDetailError} />
          : sessionDetail && sessionDetail.messages.length ?
            sessionDetail.messages.map((message) => renderMessage(message))
          : <MobileEmptyState title="No conversation" body="Start with a prompt from the composer." />}
        </div>
      </div>

      <MobileComposer
        draft={draft}
        disabled={!selectedSessionId || runActive}
        runActive={runActive}
        runInFlight={runInFlight}
        canSend={canSend}
        canContinue={canContinue}
        pendingApproval={pendingApproval}
        sendPromptError={sendPromptError}
        sessionNotice={sessionNotice}
        textareaRef={textareaRef}
        mentionMenu={mentionMenu}
        onDraftChange={onDraftChange}
        onComposerKeyDown={onComposerKeyDown}
        onSubmitPrompt={onSubmitPrompt}
        onContinueSession={onContinueSession}
        onCancelSessionRun={onCancelSessionRun}
        onResolveApproval={onResolveApproval}
      />
    </section>
  );
}

type MobileComposerProps = {
  draft: string;
  disabled: boolean;
  runActive: boolean;
  runInFlight: boolean;
  canSend: boolean;
  canContinue: boolean;
  pendingApproval: MobileChatScreenProps['pendingApproval'];
  sendPromptError?: string;
  sessionNotice?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mentionMenu?: ReactNode;
  onDraftChange: (value: string, cursor: number | null) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmitPrompt: () => void;
  onContinueSession: () => void;
  onCancelSessionRun: () => void;
  onResolveApproval: (approved: boolean) => void;
};

function MobileComposer({
  draft,
  disabled,
  runActive,
  runInFlight,
  canSend,
  canContinue,
  pendingApproval,
  sendPromptError,
  sessionNotice,
  textareaRef,
  mentionMenu,
  onDraftChange,
  onComposerKeyDown,
  onSubmitPrompt,
  onContinueSession,
  onCancelSessionRun,
  onResolveApproval,
}: MobileComposerProps) {
  const status = sendPromptError ?? sessionNotice;

  return (
    <footer className="relative shrink-0 border-t border-border bg-card px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
      {pendingApproval ? <MobileApprovalBanner approval={pendingApproval} onResolve={onResolveApproval} /> : null}
      {mentionMenu}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          className="max-h-24 min-h-10 resize-none rounded-md bg-background px-3 py-2 text-sm leading-5"
          disabled={disabled}
          placeholder={runActive ? 'Heddle is working...' : 'Message Heddle'}
          onChange={(event) => onDraftChange(event.target.value, event.target.selectionStart)}
          onClick={(event) => onDraftChange(draft, event.currentTarget.selectionStart)}
          onSelect={(event) => onDraftChange(draft, event.currentTarget.selectionStart)}
          onKeyDown={onComposerKeyDown}
        />
        <Button type="button" size="sm" className="h-10 shrink-0 px-3" disabled={!canSend} onClick={onSubmitPrompt}>
          Send
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {status ? <p className="m-0 truncate text-xs text-muted-foreground">{status}</p> : <RunStatus runActive={runActive} />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={!canContinue} onClick={onContinueSession}>
            Continue
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={!runInFlight} onClick={onCancelSessionRun}>
            Cancel
          </Button>
        </div>
      </div>
    </footer>
  );
}

function MobileApprovalBanner({
  approval,
  onResolve,
}: {
  approval: NonNullable<MobileChatScreenProps['pendingApproval']>;
  onResolve: (approved: boolean) => void;
}) {
  return (
    <section className="mb-2 overflow-hidden rounded-md border border-destructive/40 bg-destructive/10">
      <div className="flex items-center justify-between gap-2 border-b border-destructive/20 px-3 py-2">
        <div className="min-w-0">
          <p className="m-0 truncate text-xs font-semibold text-foreground">Approval required: {approval.tool}</p>
          <p className="m-0 truncate text-[11px] text-muted-foreground">Call ID: {approval.callId}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" className="h-8 px-2 text-xs" onClick={() => onResolve(true)}>
            Approve
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onResolve(false)}>
            Deny
          </Button>
        </div>
      </div>
      <pre className="m-0 max-h-[24dvh] overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[11px] leading-4 text-muted-foreground">
        {JSON.stringify(approval.input, null, 2)}
      </pre>
    </section>
  );
}

function RunStatus({ runActive }: { runActive: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <Badge variant={runActive ? 'outline' : 'secondary'}>{runActive ? 'working' : 'idle'}</Badge>
      <span className="text-xs text-muted-foreground">Enter sends</span>
    </div>
  );
}

function MobileEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <p className="m-0 mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
