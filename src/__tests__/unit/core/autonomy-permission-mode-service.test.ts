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
    expect(AutonomyPermissionModeService.resolveGrant({
      config: {},
      workspaceRoot,
    })).toEqual({
      mode: 'default',
      boundaryBehavior: 'request',
      authority: { kind: 'default' },
    });
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
    expect(AutonomyPermissionModeService.resolveGrant({
      config: { permissionMode: 'auto' },
      workspaceRoot,
    })).toMatchObject({
      mode: 'auto',
      boundaryBehavior: 'request',
      authority: {
        kind: 'autopilot',
        profile: { preset: 'auto' },
      },
    });
  });

  it('maps unattended mode to Auto authority with deny-on-boundary behavior', () => {
    const grant = AutonomyPermissionModeService.resolveGrant({
      config: {
        permissionMode: 'unattended',
        autoTrustedRoots: ['../trusted-repo'],
      },
      workspaceRoot,
    });

    expect(grant).toMatchObject({
      mode: 'unattended',
      boundaryBehavior: 'deny',
      authority: {
        kind: 'autopilot',
        profile: {
          mode: 'autopilot',
          preset: 'auto',
          roots: expect.arrayContaining([
            expect.objectContaining({ path: '../trusted-repo', access: 'autopilot' }),
          ]),
        },
      },
    });
    expect(AutonomyPermissionModeService.buildOptions({
      config: { permissionMode: 'unattended' },
      workspaceRoot,
    })).toContainEqual(expect.objectContaining({
      id: 'unattended',
      label: 'Unattended',
    }));
    expect(AutonomyPermissionModeService.resolveAutoRootTrustProfile(grant)).toBeUndefined();
  });

  it('maps unrestricted mode to prompt-free bypass authority without an Auto profile', () => {
    const config = { permissionMode: 'unrestricted' as const };

    expect(AutonomyPermissionModeService.resolveGrant({
      config,
      workspaceRoot,
    })).toEqual({
      mode: 'unrestricted',
      boundaryBehavior: 'allow',
      authority: { kind: 'unrestricted' },
    });
    expect(AutonomyPermissionModeService.resolveEffectiveProfile({
      config,
      workspaceRoot,
    })).toBeUndefined();
    expect(AutonomyPermissionModeService.buildOptions({
      config,
      workspaceRoot,
    })).toContainEqual(expect.objectContaining({
      id: 'unrestricted',
      label: 'Unrestricted',
    }));
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
    expect(AutonomyPermissionModeService.resolveAutoRootTrustProfile(
      AutonomyPermissionModeService.resolveGrant({ config, workspaceRoot }),
    )).toBeDefined();
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
