/** Raised when a caller attempts to create a session whose id already exists. */
export class ChatSessionAlreadyExistsError extends Error {
  readonly code = 'CHAT_SESSION_ALREADY_EXISTS';

  constructor(readonly sessionId: string) {
    super(`Chat session already exists: ${sessionId}`);
    this.name = 'ChatSessionAlreadyExistsError';
  }
}

/** Raised when an optimistic write no longer matches the stored revision. */
export class ChatSessionRevisionConflictError extends Error {
  readonly code = 'CHAT_SESSION_REVISION_CONFLICT';

  constructor(
    readonly sessionId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Chat session revision conflict for ${sessionId}: expected ${expectedRevision}, found ${actualRevision}`,
    );
    this.name = 'ChatSessionRevisionConflictError';
  }
}

/** Raised when a file adapter receives a cursor it did not produce. */
export class InvalidChatSessionCursorError extends Error {
  readonly code = 'INVALID_CHAT_SESSION_CURSOR';

  constructor() {
    super('Invalid chat session cursor.');
    this.name = 'InvalidChatSessionCursorError';
  }
}

/** Raised when persisted session files exist but cannot be read safely. */
export class ChatSessionStorageCorruptionError extends Error {
  readonly code = 'CHAT_SESSION_STORAGE_CORRUPTION';

  constructor(readonly storagePath: string, detail: string) {
    super(`Invalid chat session storage at ${storagePath}: ${detail}`);
    this.name = 'ChatSessionStorageCorruptionError';
  }
}

/** Raised when an adapter violates the reusable repository conformance contract. */
export class ChatSessionRepositoryConformanceError extends Error {
  readonly code = 'CHAT_SESSION_REPOSITORY_CONFORMANCE';

  constructor(
    readonly scenario: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`Chat session repository conformance failed (${scenario}): ${detail}`, options);
    this.name = 'ChatSessionRepositoryConformanceError';
  }
}
