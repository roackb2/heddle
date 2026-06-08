import { isAbsolute, relative, resolve } from 'node:path';
import type {
  AutopilotProfile,
  AutopilotRootPolicy,
  NormalizedAutopilotProfile,
  NormalizedAutopilotRootPolicy,
} from './types.js';

export const DEFAULT_INTERACTIVE_AUTOPILOT_PROFILE: NormalizedAutopilotProfile = {
  mode: 'interactive',
  roots: [],
  environments: {
    allow: ['local', 'dev'],
    requireApproval: ['staging', 'production', 'unknown'],
  },
};

/**
 * Normalizes configured roots once at the approval/autonomy boundary.
 */
export class AutopilotProfileService {
  static normalize(args: {
    profile?: AutopilotProfile;
    workspaceRoot: string;
  }): NormalizedAutopilotProfile {
    if (!args.profile) {
      return DEFAULT_INTERACTIVE_AUTOPILOT_PROFILE;
    }

    return {
      ...args.profile,
      roots: args.profile.roots.map((root) => AutopilotProfileService.normalizeRoot({
        root,
        workspaceRoot: args.workspaceRoot,
      })),
    };
  }

  static findRootPolicy(args: {
    profile: NormalizedAutopilotProfile;
    target: string;
  }): NormalizedAutopilotRootPolicy | undefined {
    const resolvedTarget = resolve(args.target);
    return args.profile.roots
      .filter((root) => AutopilotProfileService.isInsideRoot(resolvedTarget, root.path))
      .sort((left, right) => right.path.length - left.path.length)[0];
  }

  static isInsideRoot(target: string, root: string): boolean {
    const relativeTarget = relative(resolve(root), resolve(target));
    return relativeTarget === '' || (!relativeTarget.startsWith('..') && !isAbsolute(relativeTarget));
  }

  private static normalizeRoot(args: {
    root: AutopilotRootPolicy;
    workspaceRoot: string;
  }): NormalizedAutopilotRootPolicy {
    return {
      ...args.root,
      path: resolve(args.workspaceRoot, args.root.path),
    };
  }
}
