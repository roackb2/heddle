/** A host attempted to start a second run for the same active address. */
export class ConversationRunConflictError extends Error {
  constructor(readonly addressKey: string) {
    super(`A conversation run is already in progress for address ${addressKey}.`);
    this.name = 'ConversationRunConflictError';
  }
}

/** A run ID is unknown, expired, or does not belong to the supplied address. */
export class ConversationRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Conversation run not found: ${runId}`);
    this.name = 'ConversationRunNotFoundError';
  }
}

/** A subscriber requested events that have already left the bounded replay window. */
export class ConversationRunReplayUnavailableError extends Error {
  constructor(
    readonly runId: string,
    readonly requestedSequence: number,
    readonly oldestRetainedSequence: number,
  ) {
    super(
      `Conversation run replay cursor ${requestedSequence} is older than retained sequence ${oldestRetainedSequence}.`,
    );
    this.name = 'ConversationRunReplayUnavailableError';
  }
}

/** Internal execution signal used when cancellation wins a late completion race. */
export class ConversationRunCancelledError extends Error {
  constructor(readonly runId: string) {
    super(`Conversation run cancelled: ${runId}`);
    this.name = 'ConversationRunCancelledError';
  }
}
