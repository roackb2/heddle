import type { HostedAgentConversation } from '../../../02-http-sse-api/contracts.js';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './ai-elements/conversation.js';
import {
  Message,
  MessageContent,
  MessageResponse,
} from './ai-elements/message.js';
import { ConversationMessage } from './ConversationMessage.js';

type ConversationViewProps = {
  conversation?: HostedAgentConversation;
  liveAssistantText: string;
  isLoading: boolean;
};

export function ConversationView({
  conversation,
  liveAssistantText,
  isLoading,
}: ConversationViewProps) {
  if (isLoading) {
    return <ConversationSkeleton />;
  }

  const messages = conversation?.messages ?? [];
  return (
    <Conversation className="rounded-lg border border-slate-800 bg-slate-950">
      <ConversationContent>
        {messages.length === 0 && !liveAssistantText ? (
          <ConversationEmptyState />
        ) : (
          <>
            {messages.map((message) => (
              <ConversationMessage key={message.id} message={message} />
            ))}
            {liveAssistantText ? (
              <Message from="assistant">
                <span className="text-xs font-medium text-slate-500">Agent · responding</span>
                <MessageContent>
                  <MessageResponse isAnimating>{liveAssistantText}</MessageResponse>
                </MessageContent>
              </Message>
            ) : null}
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function ConversationSkeleton() {
  return (
    <div
      aria-label="Loading conversation"
      className="flex min-h-0 flex-1 flex-col gap-6 rounded-lg border border-slate-800 bg-slate-950 p-8"
      role="status"
    >
      <div className="h-16 w-2/3 rounded-lg bg-slate-900" />
      <div className="ml-auto h-14 w-1/2 rounded-lg bg-slate-800" />
      <span className="sr-only">Loading conversation</span>
    </div>
  );
}
