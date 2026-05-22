import { memo } from 'react';
import type { ControlPlaneSessionDetail } from '@web/hooks/useControlPlaneSessionDetail';
import { AssistantMarkdown } from './AssistantMarkdown';

type ConversationMessageView = NonNullable<ControlPlaneSessionDetail>['messages'][number];

export const ConversationMessage = memo(function ConversationMessage({ message }: { message: ConversationMessageView }) {
  if (message.role === 'user') {
    return (
      <article className="v2-message-row v2-message-row-user" data-message-role="user">
        <div className="v2-type-body v2-user-message-card">
          {message.text}
        </div>
      </article>
    );
  }

  return (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <div className="v2-type-body v2-assistant-article-shell">
        <AssistantMarkdown markdown={message.text} />
      </div>
    </article>
  );
});
