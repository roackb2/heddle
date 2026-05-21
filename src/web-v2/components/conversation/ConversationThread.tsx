import type { ControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { ConversationComposer } from './ConversationComposer';
import { ConversationMessage } from './ConversationMessage';

interface ConversationThreadProps {
  session: ControlPlaneSessionDetail;
  loading: boolean;
  emptyTitle: string;
}

// ConversationThread renders the selected session in the central work area.
// It stays read-only until the composer and turn-running flow are introduced.
export function ConversationThread({ session, loading, emptyTitle }: ConversationThreadProps) {
  if (loading && !session) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {emptyTitle}
        </div>
        <div className="v2-composer-region">
          <ConversationComposer />
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
          <ConversationComposer />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
          {session.messages.map((message) => (
            <ConversationMessage key={message.id} message={message} />
          ))}
        </div>
      </div>
      <div className="v2-composer-region">
        <ConversationComposer />
      </div>
    </div>
  );
}
