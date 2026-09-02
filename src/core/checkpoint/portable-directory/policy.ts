import { PortableDirectoryCheckpointCodec } from './codec.js';
import { PortableDirectoryCheckpointPolicyError } from './errors.js';
import type {
  PortableDirectoryCheckpointLimits,
  PortableDirectoryCheckpointPolicyOptions,
} from './types.js';

const LIMIT_NAMES: ReadonlyArray<keyof PortableDirectoryCheckpointLimits> = [
  'maxFileCount',
  'maxFileBytes',
  'maxTotalBytes',
];

/**
 * Resolves one immutable selection and resource policy for directory capture
 * and restore. Callers must choose every bound explicitly.
 */
export class PortableDirectoryCheckpointPolicy {
  readonly limits: PortableDirectoryCheckpointLimits;
  readonly unsafePathBehavior: 'reject' | 'exclude';
  private readonly includeFile: PortableDirectoryCheckpointPolicyOptions['includeFile'];

  constructor(options: PortableDirectoryCheckpointPolicyOptions) {
    if (typeof options.includeFile !== 'function') {
      throw new PortableDirectoryCheckpointPolicyError('includeFile must be a function');
    }

    for (const name of LIMIT_NAMES) {
      const value = options.limits[name];
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new PortableDirectoryCheckpointPolicyError(`${name} must be a non-negative safe integer`);
      }
    }
    if (options.unsafePathBehavior !== undefined
      && options.unsafePathBehavior !== 'reject'
      && options.unsafePathBehavior !== 'exclude') {
      throw new PortableDirectoryCheckpointPolicyError(
        'unsafePathBehavior must be either reject or exclude',
      );
    }

    this.limits = Object.freeze({ ...options.limits });
    this.unsafePathBehavior = options.unsafePathBehavior ?? 'reject';
    this.includeFile = options.includeFile;
  }

  /** Returns false for both excluded files and paths that are not safely portable. */
  includes(path: string): boolean {
    return PortableDirectoryCheckpointCodec.isSafeRelativePath(path) && this.includeFile(path);
  }
}
