import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { ControlPlaneModelOptions } from '@web/api/client';
import type {
  ControlPlaneApprovalDecision,
  ControlPlaneReasoningEffortSelection,
  ControlPlanePendingApproval,
  ControlPlaneSessionDetail,
} from '@web/hooks/sessions/useControlPlaneSessionDetail';
import { ApprovalPanel } from './ApprovalPanel';
import { ConversationComposer } from './ConversationComposer';
import { ConversationMessage } from './ConversationMessage';
import { Loader2 } from 'lucide-react';

const userScrollKeys = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const previousResponseActiveRef = useRef(false);
  const programmaticScrollFrameRef = useRef<number | undefined>(undefined);
  const responseActive = Boolean(
    submitting ||
    liveStatus ||
    session?.messages.some((message) => message.isStreaming || message.isPending),
  );
  const conversationScrollKey = useMemo(() => {
    if (!session) {
      return '';
    }

    const lastMessage = session.messages.at(-1);
    return [
      session.id,
      session.messages.length,
      lastMessage?.id,
      lastMessage?.text.length,
      lastMessage?.isStreaming,
      lastMessage?.isPending,
      liveStatus,
    ].join(':');
  }, [liveStatus, session]);
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    if (programmaticScrollFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
    }

    userScrollIntentRef.current = false;
    container.dataset.programmaticScroll = 'true';
    container.scrollTop = container.scrollHeight;
    programmaticScrollFrameRef.current = window.requestAnimationFrame(() => {
      delete container.dataset.programmaticScroll;
      programmaticScrollFrameRef.current = undefined;
    });
  }, []);
  const handleUserScrollIntent = useCallback(() => {
    if (responseActive) {
      userScrollIntentRef.current = true;
    }
  }, [responseActive]);
  const handleScrollKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (userScrollKeys.has(event.key)) {
      handleUserScrollIntent();
    }
  }, [handleUserScrollIntent]);
  const handleConversationScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || container.dataset.programmaticScroll === 'true') {
      return;
    }

    if (responseActive && userScrollIntentRef.current) {
      autoScrollEnabledRef.current = false;
    }
  }, [responseActive]);

  useEffect(() => () => {
    if (programmaticScrollFrameRef.current) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    if (!session?.id) {
      return;
    }

    autoScrollEnabledRef.current = true;
    userScrollIntentRef.current = false;
    scrollToBottom();
  }, [scrollToBottom, session?.id]);

  useEffect(() => {
    if (responseActive && !previousResponseActiveRef.current) {
      autoScrollEnabledRef.current = true;
      userScrollIntentRef.current = false;
      scrollToBottom();
    }

    if (!responseActive) {
      userScrollIntentRef.current = false;
    }

    previousResponseActiveRef.current = responseActive;
  }, [responseActive, scrollToBottom]);

  useLayoutEffect(() => {
    if (autoScrollEnabledRef.current) {
      scrollToBottom();
    }
  }, [conversationScrollKey, scrollToBottom]);

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
        ref={scrollContainerRef}
        className="v2-conversation-scroll v2-scrollbar-hidden min-h-0 flex-1 overflow-auto"
        onKeyDown={handleScrollKeyDown}
        onPointerDown={handleUserScrollIntent}
        onScroll={handleConversationScroll}
        onTouchStart={handleUserScrollIntent}
        onWheel={handleUserScrollIntent}
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
