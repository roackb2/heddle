import { memo } from 'react';
import type { ControlPlaneSessionDetail } from '@web/hooks/sessions/useControlPlaneSessionDetail';
import { AssistantMarkdown } from './AssistantMarkdown';
import { DirectShellResultMessage } from './DirectShellResultMessage';

type ConversationMessageView = NonNullable<ControlPlaneSessionDetail>['messages'][number];
type ConversationTurnAgentView = NonNullable<ControlPlaneSessionDetail>['turns'][number]['agent'];

export const ConversationMessage = memo(function ConversationMessage({
  message,
  turnAgent,
}: {
  message: ConversationMessageView;
  turnAgent?: ConversationTurnAgentView;
}) {
  if (message.role === 'user') {
    return (
      <article className="v2-message-row v2-message-row-user" data-message-role="user">
        {turnAgent ? (
          <p className="v2-user-message-agent-label truncate">{turnAgent.name}</p>
        ) : null}
        <div className="v2-type-body v2-user-message-card">
          {message.text}
        </div>
      </article>
    );
  }

  return message.directShellResult ? (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <DirectShellResultMessage result={message.directShellResult} />
    </article>
  ) : (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <div className="v2-type-body v2-assistant-article-shell">
        <AssistantMarkdown markdown={message.text} />
      </div>
    </article>
  );
});
