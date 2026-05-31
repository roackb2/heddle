import type { ControlPlaneModelOptions } from '@web/api/client';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneReasoningEffortSelection,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/sessions/useControlPlaneSessionDetail';
import type { ControlPlaneSessionRuntimeContext } from '@web/api/client';
import { useConversationAutoScroll } from '@web/hooks/conversation/useConversationAutoScroll';
import type { ClientSharedSessionPlan } from '@/client-shared/services/session-activities';
import type {
  ClientSharedAgentActivityStatus,
  ClientSharedSessionLatestUpdate,
} from '@/client-shared/services/session-activities';
import { AgentActivityStatus } from './AgentActivityStatus';
import { AgentPlanPanel } from './AgentPlanPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ConversationComposer } from './ConversationComposer';
import { ConversationMessage } from './ConversationMessage';
import { ConversationWelcomePanel } from './ConversationWelcomePanel';
import { QueuedPromptStrip } from './QueuedPromptStrip';
import { Loader2 } from 'lucide-react';

interface ConversationThreadProps {
  workspaceId?: string;
  session: ControlPlaneSessionDetail;
  loading: boolean;
  submitting: boolean;
  running: boolean;
  cancelling: boolean;
  liveStatus?: string;
  currentActivity?: ClientSharedAgentActivityStatus;
  latestUpdate?: ClientSharedSessionLatestUpdate;
  activePlan?: ClientSharedSessionPlan;
  runtimeContext?: ControlPlaneSessionRuntimeContext;
  pendingApproval: ControlPlanePendingApproval;
  approvalResolving: boolean;
  approvalError?: string;
  modelOptions?: ControlPlaneModelOptions;
  settingsUpdating: boolean;
  settingsError?: string;
  queueUpdating: boolean;
  emptyTitle: string;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onUpdateQueuedPrompt: (queueItemId: string, prompt: string) => Promise<void>;
  onDeleteQueuedPrompt: (queueItemId: string) => Promise<void>;
  onCancelRun: () => Promise<void>;
  onUpdateDriftEnabled: (enabled: boolean) => Promise<void>;
  onUpdateModel: (model: string) => Promise<void>;
  onUpdateReasoningEffort: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
  onResolveApproval: (decision: ControlPlaneApprovalDecision) => Promise<void>;
}

// ConversationThread renders the selected session in the central work area.
export function ConversationThread({
  workspaceId,
  session,
  loading,
  submitting,
  running,
  cancelling,
  liveStatus,
  currentActivity,
  latestUpdate,
  activePlan,
  runtimeContext,
  pendingApproval,
  approvalResolving,
  approvalError,
  modelOptions,
  settingsUpdating,
  settingsError,
  queueUpdating,
  emptyTitle,
  onSubmitPrompt,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
  onCancelRun,
  onUpdateDriftEnabled,
  onUpdateModel,
  onUpdateReasoningEffort,
  onResolveApproval,
}: ConversationThreadProps) {
  const hasUserMessage = session?.messages.some((message) => message.role === 'user') ?? false;
  const showWelcome = Boolean(runtimeContext?.welcomeGuide && !hasUserMessage && !submitting);
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
          <ConversationComposer disabled workspaceId={workspaceId} onSubmitPrompt={onSubmitPrompt} />
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
          <ConversationComposer disabled workspaceId={workspaceId} onSubmitPrompt={onSubmitPrompt} />
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
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-6 py-8">
          {loading ? (
            <div className="v2-type-panel-subtitle inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Updating conversation...
            </div>
          ) : null}
          {showWelcome && runtimeContext?.welcomeGuide ? (
            <ConversationWelcomePanel welcomeGuide={runtimeContext.welcomeGuide} />
          ) : null}
          {session.messages.map((message) => (
            <ConversationMessage key={message.id} message={message} />
          ))}
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
      {activePlan ? (
        <div className="v2-agent-plan-region">
          <AgentPlanPanel plan={activePlan} />
        </div>
      ) : null}
      {currentActivity || latestUpdate ? (
        <div className="v2-agent-activity-region">
          <AgentActivityStatus currentActivity={currentActivity} latestUpdate={latestUpdate} />
        </div>
      ) : null}
      <div className="v2-composer-region">
        <QueuedPromptStrip
          queuedPrompts={session.queuedPrompts}
          updating={queueUpdating}
          onUpdateQueuedPrompt={onUpdateQueuedPrompt}
          onDeleteQueuedPrompt={onDeleteQueuedPrompt}
        />
        <ConversationComposer
          key={`${workspaceId ?? 'workspace'}:${session.id}`}
          sessionId={session.id}
          workspaceId={workspaceId}
          disabled={false}
          driftEnabled={session.driftEnabled ?? false}
          driftLevel={session.driftLevel}
          model={session.model}
          modelOptions={modelOptions}
          reasoningEffort={session.reasoningEffort}
          settingsUpdating={settingsUpdating}
          settingsError={settingsError}
          submitting={submitting}
          running={running}
          cancelling={cancelling}
          onSubmitPrompt={onSubmitPrompt}
          onCancelRun={onCancelRun}
          onUpdateDriftEnabled={onUpdateDriftEnabled}
          onUpdateModel={onUpdateModel}
          onUpdateReasoningEffort={onUpdateReasoningEffort}
        />
      </div>
    </div>
  );
}
