// Presentation clients stay on the client-shared boundary while reusing the
// exact public remote-run implementation exported by the Heddle SDK.
export {
  ConversationRunConsumerService,
  ConversationRunSequenceGapError,
  ConversationRunTerminalViolationError,
} from '@heddleagent/run-client';
export type {
  ConversationRunConsumerEvent,
  ConversationRunEventAcceptance,
  ConversationRunReference,
  ConversationRunRetry,
  ConversationRunSubscriptionInput,
} from '@heddleagent/run-client';
