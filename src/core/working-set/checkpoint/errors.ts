import type { WorkingSetScopeId } from '../scope.js';
import type { WorkingSetCheckpointGenerationId } from './schemas.js';

/** Raised when the service is pointed at an unsafe disposable-directory root. */
export class WorkingSetCheckpointConfigurationError extends Error {
  readonly code = 'WORKING_SET_CHECKPOINT_CONFIGURATION_ERROR';

  constructor(readonly detail: string, options?: ErrorOptions) {
    super(`Invalid working-set checkpoint configuration: ${detail}`, options);
    this.name = 'WorkingSetCheckpointConfigurationError';
  }
}

/** Raised when persisted checkpoint data cannot be trusted or restored. */
export class WorkingSetCheckpointCorruptionError extends Error {
  readonly code = 'WORKING_SET_CHECKPOINT_CORRUPTION';

  constructor(
    readonly scopeId: WorkingSetScopeId,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid working-set checkpoint for ${scopeId}: ${detail}`, options);
    this.name = 'WorkingSetCheckpointCorruptionError';
  }
}

/** Raised by stores when another writer advances the committed generation. */
export class WorkingSetCheckpointConflictError extends Error {
  readonly code = 'WORKING_SET_CHECKPOINT_CONFLICT';

  constructor(
    readonly scopeId: WorkingSetScopeId,
    readonly expectedGenerationId: WorkingSetCheckpointGenerationId | null,
    readonly actualGenerationId: WorkingSetCheckpointGenerationId | null,
  ) {
    super(
      `Working-set checkpoint conflict for ${scopeId}: expected ${expectedGenerationId ?? 'no generation'}, found ${actualGenerationId ?? 'no generation'}.`,
    );
    this.name = 'WorkingSetCheckpointConflictError';
  }
}

/** Raised when a local working set cannot be captured under its bounds. */
export class WorkingSetCheckpointCaptureError extends Error {
  readonly code = 'WORKING_SET_CHECKPOINT_CAPTURE_ERROR';

  constructor(readonly workingRoot: string, readonly detail: string, options?: ErrorOptions) {
    super(`Failed to capture working-set checkpoint from ${workingRoot}: ${detail}`, options);
    this.name = 'WorkingSetCheckpointCaptureError';
  }
}

/** Raised when the disposable local root cannot be prepared from durable truth. */
export class WorkingSetCheckpointRecoveryError extends Error {
  readonly code = 'WORKING_SET_CHECKPOINT_RECOVERY_ERROR';

  constructor(readonly workingRoot: string, readonly detail: string, options?: ErrorOptions) {
    super(`Failed to prepare working set at ${workingRoot}: ${detail}`, options);
    this.name = 'WorkingSetCheckpointRecoveryError';
  }
}
