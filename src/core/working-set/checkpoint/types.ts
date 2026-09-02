import type { PortableDirectoryCheckpointLimits } from '../../checkpoint/portable-directory/index.js';
import type { WorkingSetScopeId } from '../scope.js';
import type {
  WorkingSetCheckpointGeneration,
  WorkingSetCheckpointGenerationId,
  WorkingSetCheckpointManifest,
} from './schemas.js';

export type LoadWorkingSetCheckpointGenerationInput = {
  scopeId: WorkingSetScopeId;
  generationId: WorkingSetCheckpointGenerationId;
};

export type CommitWorkingSetCheckpointInput = {
  expectedGenerationId: WorkingSetCheckpointGenerationId | null;
  generation: WorkingSetCheckpointGeneration;
  manifest: WorkingSetCheckpointManifest;
};

/**
 * Provider-neutral durable storage for one identity-scoped working set.
 *
 * `commit` must persist the immutable generation before atomically advancing
 * the scope manifest only when it still names `expectedGenerationId`.
 * Competing advancement raises `WorkingSetCheckpointConflictError`. Exact
 * repeats of the same immutable generation and manifest may succeed
 * idempotently. Authorization of each scope remains the adapter's duty.
 */
export type WorkingSetCheckpointStore = {
  loadManifest(scopeId: WorkingSetScopeId): Promise<unknown | undefined>;
  loadGeneration(input: LoadWorkingSetCheckpointGenerationInput): Promise<unknown | undefined>;
  commit(input: CommitWorkingSetCheckpointInput): Promise<void>;
};

export type WorkingSetCheckpointServiceOptions = {
  limits: PortableDirectoryCheckpointLimits;
  /**
   * Privileged host operation that resets only the dedicated disposable local
   * working copy. The service verifies its postcondition before recovery.
   */
  resetLocalWorkingCopy: () => Promise<void>;
  now?: () => Date;
  createGenerationId?: () => WorkingSetCheckpointGenerationId;
};

export type WorkingSetCheckpointBundle = {
  manifest: WorkingSetCheckpointManifest;
  generation: WorkingSetCheckpointGeneration;
};

export type PrepareOrRecoverWorkingSetResult =
  | {
    status: 'initialized-empty';
    workingRoot: string;
  }
  | {
    status: 'restored-committed';
    workingRoot: string;
    manifest: WorkingSetCheckpointManifest;
  };
