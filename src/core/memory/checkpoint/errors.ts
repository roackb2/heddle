import type { MemoryScopeId } from '../scope.js';
import type { MemoryCheckpointGenerationId } from './schemas.js';

/** Raised when persisted checkpoint data cannot be trusted or restored. */
export class MemoryCheckpointCorruptionError extends Error {
  readonly code = 'MEMORY_CHECKPOINT_CORRUPTION';

  constructor(
    readonly scopeId: MemoryScopeId,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid memory checkpoint for ${scopeId}: ${detail}`, options);
    this.name = 'MemoryCheckpointCorruptionError';
  }
}

/** Raised by stores when another writer advances the committed generation. */
export class MemoryCheckpointConflictError extends Error {
  readonly code = 'MEMORY_CHECKPOINT_CONFLICT';

  constructor(
    readonly scopeId: MemoryScopeId,
    readonly expectedGenerationId: MemoryCheckpointGenerationId | null,
    readonly actualGenerationId: MemoryCheckpointGenerationId | null,
  ) {
    super(
      `Memory checkpoint conflict for ${scopeId}: expected ${expectedGenerationId ?? 'no generation'}, found ${actualGenerationId ?? 'no generation'}.`,
    );
    this.name = 'MemoryCheckpointConflictError';
  }
}

/** Raised when restore would merge with or overwrite an existing working copy. */
export class MemoryCheckpointRestoreTargetError extends Error {
  readonly code = 'MEMORY_CHECKPOINT_RESTORE_TARGET_NOT_EMPTY';

  constructor(readonly memoryRoot: string) {
    super(`Memory checkpoint restore requires an absent or empty memory root: ${memoryRoot}`);
    this.name = 'MemoryCheckpointRestoreTargetError';
  }
}

/** Raised when the local working copy cannot be captured safely. */
export class MemoryCheckpointCaptureError extends Error {
  readonly code = 'MEMORY_CHECKPOINT_CAPTURE_ERROR';

  constructor(readonly memoryRoot: string, detail: string, options?: ErrorOptions) {
    super(`Failed to capture memory checkpoint from ${memoryRoot}: ${detail}`, options);
    this.name = 'MemoryCheckpointCaptureError';
  }
}
