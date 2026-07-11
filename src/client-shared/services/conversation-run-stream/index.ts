// Presentation clients stay on the client-shared boundary while reusing the
// exact public remote-run implementation exported by the Heddle SDK.
export {
  ConversationRunConsumerService,
  ConversationRunSequenceGapError,
  ConversationRunTerminalViolationError,
} from '@/core/chat/remote/index.js';
export type {
  ConversationRunConsumerEvent,
  ConversationRunEventAcceptance,
  ConversationRunReference,
  ConversationRunRetry,
  ConversationRunSubscriptionInput,
} from '@/core/chat/remote/index.js';
