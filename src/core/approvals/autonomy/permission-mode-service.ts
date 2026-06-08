import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import isEqual from 'lodash/isEqual.js';
import type {
  AutonomyPermissionMode,
  AutonomyPermissionModeConfig,
  AutonomyPermissionModeOption,
  AutopilotCapability,
  AutopilotProfile,
} from './types.js';
import { AutopilotProfileService } from './profile-service.js';

export const AUTO_CAPABILITIES = [
  'read',
  'write',
  'execute',
  'simple-delete',
  'many-file-edit',
  'verification',
  'formatting',
  'dependency',
  'git-stage',
] as const satisfies NonNullable<AutopilotProfile['roots'][number]['allow']>;

const AUTO_ROOT_POLICY = {
  access: 'autopilot',
  allow: [...AUTO_CAPABILITIES],
} as const satisfies Pick<AutopilotProfile['roots'][number], 'access' | 'allow'>;

/**
 * Owns the product-level permission mode mapping for autonomy.
 *
 * UI surfaces should select Default/Auto/Custom only. This service maps those
 * modes to the effective autopilot profile so hosts do not duplicate policy.
 */
export class AutonomyPermissionModeService {
  static buildAutoProfile(args: { trustedRoots?: string[] } = {}): AutopilotProfile {
    const trustedRoots = [...new Set(args.trustedRoots ?? [])]
      .filter((path) => path.trim().length > 0 && path !== '.')
      .map((path) => ({
        path,
        ...AUTO_ROOT_POLICY,
        source: 'user-trusted-repo' as const,
      }));

    return {
      mode: 'autopilot',
      preset: 'auto',
      roots: [
        {
          path: '.',
          ...AUTO_ROOT_POLICY,
          source: 'generated-working-root',
        },
        ...trustedRoots,
        {
          path: homedir(),
          access: 'manual-only',
          source: 'safety-default',
        },
        {
          path: '/Volumes',
          access: 'deny',
          source: 'safety-default',
        },
        {
          path: '/dev',
          access: 'deny',
          source: 'safety-default',
        },
      ],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };
  }

  static resolveMode(args: {
    config: AutonomyPermissionModeConfig;
    workspaceRoot: string;
  }): AutonomyPermissionMode {
    if (args.config.permissionMode) {
      return args.config.permissionMode === 'custom' && !AutonomyPermissionModeService.hasCustomProfile(args)
        ? 'default'
        : args.config.permissionMode;
    }

    if (!args.config.autopilot || args.config.autopilot.mode === 'interactive') {
      return 'default';
    }

    return AutonomyPermissionModeService.isGeneratedAutoProfile({
      profile: args.config.autopilot,
      workspaceRoot: args.workspaceRoot,
    }) ? 'auto' : 'custom';
  }

  static resolveEffectiveProfile(args: {
    config: AutonomyPermissionModeConfig;
    workspaceRoot: string;
  }): AutopilotProfile | undefined {
    const mode = AutonomyPermissionModeService.resolveMode(args);
    if (mode === 'default') {
      return undefined;
    }

    if (mode === 'auto') {
      return AutonomyPermissionModeService.buildAutoProfile({
        trustedRoots: args.config.autoTrustedRoots,
      });
    }

    return args.config.autopilot?.mode === 'autopilot' ? args.config.autopilot : undefined;
  }

  static buildOptions(args: {
    config: AutonomyPermissionModeConfig;
    workspaceRoot: string;
  }): AutonomyPermissionModeOption[] {
    const customAvailable = AutonomyPermissionModeService.hasCustomProfile(args);

    return [
      {
        id: 'default',
        label: 'Default',
        description: 'Use normal permission behavior.',
      },
      {
        id: 'auto',
        label: 'Auto',
        description: 'Run trusted local coding actions without routine approval.',
      },
      {
        id: 'custom',
        label: 'Custom',
        description: 'Use a hand-authored workspace autopilot profile.',
        disabled: !customAvailable,
        disabledReason: customAvailable ? undefined : 'Custom profile editing is not available yet.',
      },
    ];
  }

  static applyMode(args: {
    config: AutonomyPermissionModeConfig;
    mode: AutonomyPermissionMode;
    workspaceRoot: string;
  }): AutonomyPermissionModeConfig {
    if (args.mode === 'custom') {
      const customAvailable = AutonomyPermissionModeService.hasCustomProfile(args);
      if (!customAvailable) {
        throw new Error('Custom permission mode requires an existing custom autopilot profile.');
      }
    }

    return {
      ...args.config,
      permissionMode: args.mode,
    };
  }

  static trustAutoRoot(args: {
    config: AutonomyPermissionModeConfig;
    workspaceRoot: string;
    root: string;
  }): AutonomyPermissionModeConfig {
    const root = resolve(args.workspaceRoot, args.root);
    const storedRoot = AutonomyPermissionModeService.formatRootForConfig({
      workspaceRoot: args.workspaceRoot,
      root,
    });
    const existingRoots = args.config.autoTrustedRoots ?? [];
    const hasRoot = existingRoots.some((candidate) => resolve(args.workspaceRoot, candidate) === root);

    return {
      ...args.config,
      permissionMode: 'auto',
      autoTrustedRoots: hasRoot ? existingRoots : [...existingRoots, storedRoot],
    };
  }

  static addTrustedRootToProfile(args: {
    profile: AutopilotProfile;
    workspaceRoot: string;
    root: string;
  }): AutopilotProfile {
    const root = resolve(args.workspaceRoot, args.root);
    const hasRoot = args.profile.roots.some((candidate) => (
      resolve(args.workspaceRoot, candidate.path) === root
    ));
    if (hasRoot) {
      return args.profile;
    }

    args.profile.preset = 'auto';
    args.profile.roots.splice(1, 0, {
      path: root,
      ...AUTO_ROOT_POLICY,
      source: 'user-trusted-repo',
    });
    return args.profile;
  }

  static autoRootCapabilities(): AutopilotCapability[] {
    return [...AUTO_CAPABILITIES];
  }

  private static isGeneratedAutoProfile(args: {
    profile: AutopilotProfile;
    workspaceRoot: string;
  }): boolean {
    return isEqual(
      AutonomyPermissionModeService.comparableProfile(AutopilotProfileService.normalize({
        profile: args.profile,
        workspaceRoot: args.workspaceRoot,
      })),
      AutonomyPermissionModeService.comparableProfile(AutopilotProfileService.normalize({
        profile: AutonomyPermissionModeService.buildAutoProfile(),
        workspaceRoot: args.workspaceRoot,
      })),
    );
  }

  private static comparableProfile(profile: ReturnType<typeof AutopilotProfileService.normalize>) {
    return {
      mode: profile.mode,
      roots: profile.roots.map((root) => ({
        path: root.path,
        access: root.access,
        allow: root.allow,
      })),
      environments: profile.environments,
    };
  }

  private static formatRootForConfig(args: {
    workspaceRoot: string;
    root: string;
  }): string {
    if (!isAbsolute(args.root)) {
      return args.root;
    }

    const relativeRoot = relative(resolve(args.workspaceRoot), args.root);
    return relativeRoot === '' ? '.' : relativeRoot;
  }

  private static hasCustomProfile(args: {
    config: AutonomyPermissionModeConfig;
    workspaceRoot: string;
  }): boolean {
    return Boolean(args.config.autopilot?.mode === 'autopilot' && !AutonomyPermissionModeService.isGeneratedAutoProfile({
      profile: args.config.autopilot,
      workspaceRoot: args.workspaceRoot,
    }));
  }
}
