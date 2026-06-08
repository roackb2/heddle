import { describe, expect, it } from 'vitest';
import {
  AutonomyPermissionModeService,
  type AutopilotProfile,
} from '@/core/approvals/index.js';

const workspaceRoot = '/workspace/heddle';

describe('AutonomyPermissionModeService', () => {
  it('uses default mode when no autopilot profile is configured', () => {
    expect(AutonomyPermissionModeService.resolveMode({
      config: {},
      workspaceRoot,
    })).toBe('default');
    expect(AutonomyPermissionModeService.resolveEffectiveProfile({
      config: {},
      workspaceRoot,
    })).toBeUndefined();
  });

  it('maps auto mode to the generated local coding profile', () => {
    const profile = AutonomyPermissionModeService.resolveEffectiveProfile({
      config: { permissionMode: 'auto' },
      workspaceRoot,
    });

    expect(profile).toEqual(AutonomyPermissionModeService.buildAutoProfile());
    expect(profile?.roots[0]).toMatchObject({
      path: '.',
      access: 'autopilot',
    });
  });

  it('keeps auto mode when user-trusted repo roots extend the generated profile', () => {
    const config = AutonomyPermissionModeService.trustAutoRoot({
      config: { permissionMode: 'auto' },
      workspaceRoot,
      root: '/workspace/heddle-workspace-notes',
    });
    const profile = AutonomyPermissionModeService.resolveEffectiveProfile({
      config,
      workspaceRoot,
    });

    expect(AutonomyPermissionModeService.resolveMode({
      config,
      workspaceRoot,
    })).toBe('auto');
    expect(config).toEqual({
      permissionMode: 'auto',
      autoTrustedRoots: ['../heddle-workspace-notes'],
    });
    expect(profile).toEqual(expect.objectContaining({
      mode: 'autopilot',
      preset: 'auto',
    }));
    expect(profile?.roots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '../heddle-workspace-notes',
        access: 'autopilot',
        source: 'user-trusted-repo',
      }),
    ]));
  });

  it('preserves custom profiles when switching away from custom mode', () => {
    const customProfile = createCustomProfile();
    const next = AutonomyPermissionModeService.applyMode({
      config: { permissionMode: 'custom', autopilot: customProfile },
      mode: 'default',
      workspaceRoot,
    });

    expect(next).toEqual({
      permissionMode: 'default',
      autopilot: customProfile,
    });
    expect(AutonomyPermissionModeService.resolveEffectiveProfile({
      config: next,
      workspaceRoot,
    })).toBeUndefined();
  });

  it('enables custom mode only when a non-generated custom profile exists', () => {
    expect(AutonomyPermissionModeService.buildOptions({
      config: { permissionMode: 'auto' },
      workspaceRoot,
    }).find((option) => option.id === 'custom')).toMatchObject({
      disabled: true,
    });

    expect(AutonomyPermissionModeService.buildOptions({
      config: { permissionMode: 'default', autopilot: createCustomProfile() },
      workspaceRoot,
    }).find((option) => option.id === 'custom')).toMatchObject({
      disabled: false,
    });
  });

  it('does not treat interactive autopilot config as custom mode', () => {
    const interactiveProfile: AutopilotProfile = {
      mode: 'interactive',
      roots: [
        {
          path: '.',
          access: 'manual-only',
        },
      ],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };

    expect(AutonomyPermissionModeService.resolveMode({
      config: { permissionMode: 'custom', autopilot: interactiveProfile },
      workspaceRoot,
    })).toBe('default');
    expect(AutonomyPermissionModeService.resolveEffectiveProfile({
      config: { permissionMode: 'custom', autopilot: interactiveProfile },
      workspaceRoot,
    })).toBeUndefined();
    expect(AutonomyPermissionModeService.buildOptions({
      config: { permissionMode: 'default', autopilot: interactiveProfile },
      workspaceRoot,
    }).find((option) => option.id === 'custom')).toMatchObject({
      disabled: true,
    });
  });

  it('throws when custom mode is selected without a custom profile', () => {
    expect(() => AutonomyPermissionModeService.applyMode({
      config: {},
      mode: 'custom',
      workspaceRoot,
    })).toThrow('Custom permission mode requires an existing custom autopilot profile.');
    expect(() => AutonomyPermissionModeService.applyMode({
      config: {
        autopilot: {
          mode: 'interactive',
          roots: [{ path: '.', access: 'manual-only' }],
        },
      },
      mode: 'custom',
      workspaceRoot,
    })).toThrow('Custom permission mode requires an existing custom autopilot profile.');
  });
});

function createCustomProfile(): AutopilotProfile {
  return {
    mode: 'autopilot',
    roots: [
      {
        path: '../heddle-workspace-notes',
        access: 'autopilot',
        allow: ['read', 'write', 'simple-delete'],
      },
    ],
    environments: {
      allow: ['local', 'dev'],
      requireApproval: ['staging', 'production', 'unknown'],
    },
  };
}
