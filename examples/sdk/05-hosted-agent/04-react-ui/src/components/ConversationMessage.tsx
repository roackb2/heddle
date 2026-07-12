import type { HostedAgentConversation } from '../../../02-http-sse-api/contracts.js';
import {
  Message,
  MessageContent,
  MessageResponse,
} from './ai-elements/message.js';

type ConversationMessageProps = {
  message: HostedAgentConversation['messages'][number];
};

export function ConversationMessage({ message }: ConversationMessageProps) {
  return (
    <Message from={message.role}>
      <span className="text-xs font-medium text-slate-500">
        {message.role === 'user' ? 'You' : 'Agent'}
        {message.isPending ? ' · sending' : ''}
      </span>
      <MessageContent>
        {message.role === 'assistant' ? (
          <MessageResponse isAnimating={message.isStreaming}>{message.text}</MessageResponse>
        ) : (
          <p className="whitespace-pre-wrap text-pretty">{message.text}</p>
        )}
      </MessageContent>
    </Message>
  );
}
