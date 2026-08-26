import type { MemoryScopeId } from '../scope.js';
import type {
  MemoryCheckpointGeneration,
  MemoryCheckpointGenerationId,
  MemoryCheckpointManifest,
} from './schemas.js';

export type LoadMemoryCheckpointGenerationInput = {
  scopeId: MemoryScopeId;
  generationId: MemoryCheckpointGenerationId;
};

export type CommitMemoryCheckpointInput = {
  expectedGenerationId: MemoryCheckpointGenerationId | null;
  generation: MemoryCheckpointGeneration;
  manifest: MemoryCheckpointManifest;
};

export type DeleteMemoryCheckpointInput = {
  scopeId: MemoryScopeId;
  expectedGenerationId: MemoryCheckpointGenerationId;
};

/**
 * Provider-neutral durable storage for one subject-scoped Heddle memory.
 *
 * A commit must make the immutable generation durable before atomically
 * advancing the authoritative manifest from `expectedGenerationId`. Competing
 * manifest changes must raise `MemoryCheckpointConflictError`. Exact retries
 * of an already committed generation may succeed idempotently.
 */
export type MemoryCheckpointStore = {
  loadManifest(scopeId: MemoryScopeId): Promise<unknown | undefined>;
  loadGeneration(input: LoadMemoryCheckpointGenerationInput): Promise<unknown | undefined>;
  commit(input: CommitMemoryCheckpointInput): Promise<void>;
  /**
   * Atomically removes the authoritative manifest when it still points at the
   * expected generation. Immutable generation cleanup may follow the adapter's
   * documented retention policy.
   */
  delete(input: DeleteMemoryCheckpointInput): Promise<void>;
};

export type MemoryCheckpointServiceOptions = {
  now?: () => Date;
  createGenerationId?: () => MemoryCheckpointGenerationId;
};

export type MemoryCheckpointBundle = {
  manifest: MemoryCheckpointManifest;
  generation: MemoryCheckpointGeneration;
};

export type RestoreMemoryCheckpointResult =
  | { status: 'absent' }
  | {
    status: 'restored';
    memoryRoot: string;
    manifest: MemoryCheckpointManifest;
  };
