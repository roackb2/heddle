import type { ControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { ConversationComposer } from './ConversationComposer';
import { ConversationMessage } from './ConversationMessage';
import { Loader2 } from 'lucide-react';

interface ConversationThreadProps {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  submitting: boolean;
  liveStatus?: string;
  emptyTitle: string;
  onSubmitPrompt: (prompt: string) => Promise<void>;
}

// ConversationThread renders the selected session in the central work area.
export function ConversationThread({
  session,
  loading,
  submitting,
  liveStatus,
  emptyTitle,
  onSubmitPrompt,
}: ConversationThreadProps) {
  if (loading && !session) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
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
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
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
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
          {loading ? (
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
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
      <div className="v2-composer-region">
        <ConversationComposer
          submitting={submitting}
          onSubmitPrompt={onSubmitPrompt}
        />
      </div>
    </div>
  );
}
