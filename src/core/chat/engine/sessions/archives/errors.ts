/** Raised when persisted archive metadata cannot be trusted or reconstructed. */
export class ChatArchiveStorageCorruptionError extends Error {
  readonly code = 'CHAT_ARCHIVE_STORAGE_CORRUPTION';

  constructor(readonly storageLocator: string, detail: string) {
    super(`Invalid chat archive storage at ${storageLocator}: ${detail}`);
    this.name = 'ChatArchiveStorageCorruptionError';
  }
}

/** Raised when a manifest references a rolling summary the repository cannot read. */
export class ChatArchiveSummaryNotFoundError extends Error {
  readonly code = 'CHAT_ARCHIVE_SUMMARY_NOT_FOUND';

  constructor(readonly summaryLocator: string) {
    super(`Chat archive summary not found: ${summaryLocator}`);
    this.name = 'ChatArchiveSummaryNotFoundError';
  }
}

export type ChatArchiveRepositoryOperation = 'load_manifest' | 'read_summary' | 'append';

/**
 * Identifies an infrastructure failure raised while compaction is using a
 * local or host-provided archive repository. The original adapter error is
 * retained as `cause` for logging and database diagnostics.
 */
export class ChatArchiveRepositoryError extends Error {
  readonly code = 'CHAT_ARCHIVE_REPOSITORY_ERROR';

  constructor(
    readonly operation: ChatArchiveRepositoryOperation,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Chat archive repository ${operation} failed: ${detail}`, { cause });
    this.name = 'ChatArchiveRepositoryError';
  }
}
