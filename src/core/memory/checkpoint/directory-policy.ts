import { PortableDirectoryCheckpointPolicy } from '../../checkpoint/portable-directory/index.js';

const PORTABLE_MAINTENANCE_FILES = new Set([
  '_maintenance/candidates.jsonl',
  '_maintenance/runs.jsonl',
]);

/**
 * Memory v1 predates portable-directory resource limits. Safe-integer ceilings
 * preserve its accepted behavior while routing through the shared mechanism;
 * tightening them requires an explicit opt-in or a versioned memory contract.
 */
export const memoryCheckpointDirectoryPolicy = new PortableDirectoryCheckpointPolicy({
  includeFile: path => PORTABLE_MAINTENANCE_FILES.has(path)
    || (!path.startsWith('_maintenance/') && path.endsWith('.md')),
  unsafePathBehavior: 'exclude',
  limits: {
    maxFileCount: Number.MAX_SAFE_INTEGER,
    maxFileBytes: Number.MAX_SAFE_INTEGER,
    maxTotalBytes: Number.MAX_SAFE_INTEGER,
  },
});
