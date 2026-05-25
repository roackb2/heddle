import type { ControlPlaneModelOptions } from '@web/api/client';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneReasoningEffortSelection,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/sessions/useControlPlaneSessionDetail';
import { useConversationAutoScroll } from '@web/hooks/conversation/useConversationAutoScroll';
import { ApprovalPanel } from './ApprovalPanel';
import { ConversationComposer } from './ConversationComposer';
import { ConversationMessage } from './ConversationMessage';
import { Loader2 } from 'lucide-react';

interface ConversationThreadProps {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  submitting: boolean;
  liveStatus?: string;
  pendingApproval: ControlPlanePendingApproval;
  approvalResolving: boolean;
  approvalError?: string;
  modelOptions?: ControlPlaneModelOptions;
  settingsUpdating: boolean;
  settingsError?: string;
  emptyTitle: string;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onUpdateDriftEnabled: (enabled: boolean) => Promise<void>;
  onUpdateModel: (model: string) => Promise<void>;
  onUpdateReasoningEffort: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
  onResolveApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
}

// ConversationThread renders the selected session in the central work area.
export function ConversationThread({
  session,
  loading,
  submitting,
  liveStatus,
  pendingApproval,
  approvalResolving,
  approvalError,
  modelOptions,
  settingsUpdating,
  settingsError,
  emptyTitle,
  onSubmitPrompt,
  onUpdateDriftEnabled,
  onUpdateModel,
  onUpdateReasoningEffort,
  onResolveApproval,
}: ConversationThreadProps) {
  const conversationAutoScroll = useConversationAutoScroll({
    liveStatus,
    messages: session?.messages ?? [],
    sessionId: session?.id,
    submitting,
  });

  if (loading && !session) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="v2-type-panel-subtitle flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          <div className="inline-flex items-center gap-2">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            <span>{emptyTitle}</span>
          </div>
        </div>
        <div className="v2-composer-region">
          <ConversationComposer disabled onSubmitPrompt={onSubmitPrompt} />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="v2-type-panel-subtitle flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
          {emptyTitle}
        </div>
        <div className="v2-composer-region">
          <ConversationComposer disabled onSubmitPrompt={onSubmitPrompt} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div
        ref={conversationAutoScroll.scrollContainerRef}
        className="v2-conversation-scroll v2-scrollbar-hidden min-h-0 flex-1 overflow-auto"
        {...conversationAutoScroll.scrollContainerProps}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
          {loading ? (
            <div className="v2-type-panel-subtitle inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Updating conversation...
            </div>
          ) : null}
          {session.messages.map((message) => (
            <ConversationMessage key={message.id} message={message} />
          ))}
          {liveStatus ? <p className="v2-live-status-line" data-testid="web-v2-live-status">{liveStatus}</p> : null}
        </div>
      </div>
      {pendingApproval ? (
        <div className="v2-approval-region">
          <ApprovalPanel
            approval={pendingApproval}
            error={approvalError}
            resolving={approvalResolving}
            onResolve={onResolveApproval}
          />
        </div>
      ) : null}
      <div className="v2-composer-region">
        <ConversationComposer
          sessionId={session.id}
          disabled={Boolean(pendingApproval)}
          driftEnabled={session.driftEnabled ?? false}
          driftLevel={session.driftLevel}
          model={session.model}
          modelOptions={modelOptions}
          reasoningEffort={session.reasoningEffort}
          settingsUpdating={settingsUpdating}
          settingsError={settingsError}
          submitting={submitting}
          onSubmitPrompt={onSubmitPrompt}
          onUpdateDriftEnabled={onUpdateDriftEnabled}
          onUpdateModel={onUpdateModel}
          onUpdateReasoningEffort={onUpdateReasoningEffort}
        />
      </div>
    </div>
  );
}
