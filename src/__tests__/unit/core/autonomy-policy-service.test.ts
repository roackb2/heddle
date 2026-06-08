import { describe, expect, it } from 'vitest';
import { AutonomyPolicyService, type AutopilotProfile } from '@/core/approvals/index.js';
import type { ToolApprovalPolicyContext } from '@/core/approvals/types.js';

const profile: AutopilotProfile = {
  mode: 'autopilot',
  roots: [
    {
      path: '.',
      access: 'autopilot',
      allow: ['read', 'write', 'execute', 'simple-delete', 'many-file-edit', 'verification', 'formatting', 'git-stage'],
    },
    {
      path: '../sibling-repo',
      access: 'autopilot',
      allow: ['read', 'write', 'execute', 'many-file-edit'],
    },
    {
      path: '../manual',
      access: 'manual-only',
    },
    {
      path: '../denied',
      access: 'deny',
    },
  ],
  environments: {
    allow: ['local', 'dev'],
    requireApproval: ['staging', 'production', 'unknown'],
  },
};

function context(overrides: Partial<ToolApprovalPolicyContext> = {}): ToolApprovalPolicyContext {
  return {
    call: {
      id: 'call-1',
      tool: 'run_shell_mutate',
      input: {
        command: 'node scripts/update-sibling.js',
        policy: {
          operations: ['read', 'write', 'execute'],
          intent: 'update generated imports in sibling repo',
          targetRoots: ['../sibling-repo'],
          expectedEffects: ['rewrite generated import paths'],
          maxDestructiveScope: 'many-files',
          environment: 'local',
          confidence: 'high',
        },
      },
    },
    tool: {
      name: 'run_shell_mutate',
      description: 'mutates workspace',
      requiresApproval: true,
      parameters: {},
      execute: async () => ({ ok: true }),
    },
    workspaceRoot: '/workspace/current',
    ...overrides,
  };
}

describe('AutonomyPolicyService', () => {
  it('allows unknown shell when the declared envelope fits configured autopilot roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context(),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'allow',
      reason: 'allowed by autopilot profile and declared policy envelope',
    }));
    expect(evaluation.envelope?.operations).toEqual(['read', 'write', 'execute']);
    expect(evaluation.facts.claimedWriteRoots).toEqual(['/workspace/sibling-repo']);
  });

  it('requests approval when an approval-gated tool is missing an envelope', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-1',
          tool: 'run_shell_mutate',
          input: { command: 'node scripts/update-sibling.js' },
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: 'tool call needs a declared policy envelope',
    }));
  });

  it('requests approval for no-envelope reads outside configured Auto roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-read',
          tool: 'read_file',
          input: { path: '../manual/file.txt' },
        },
        tool: {
          name: 'read_file',
          description: 'reads files',
          requiresApproval: false,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: expect.stringContaining('root requires manual approval'),
    }));
  });

  it('allows no-envelope reads in configured sibling Auto roots', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-read',
          tool: 'read_file',
          input: { path: '../sibling-repo/README.md' },
        },
        tool: {
          name: 'read_file',
          description: 'reads files',
          requiresApproval: false,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision).toEqual(expect.objectContaining({
      type: 'allow',
      reason: 'allowed by autopilot profile without a required policy envelope',
    }));
  });

  it('denies hard-denied roots even when the envelope claims low risk', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-edit',
          tool: 'edit_file',
          input: {
            path: '../denied/secrets.txt',
            content: 'secret',
            createIfMissing: true,
            policy: {
              operations: ['read'],
              intent: 'inspect current workspace',
              targetRoots: ['.'],
              expectedEffects: ['read only'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
        tool: {
          name: 'edit_file',
          description: 'edits files',
          requiresApproval: true,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });

    expect(evaluation.decision.type).toBe('deny');
    expect(evaluation.facts.hardDenyReasons).toContain('root is hard-denied by autopilot policy: /workspace/denied/secrets.txt');
  });

  it('requests approval for manual-only roots and production environments', () => {
    const manual = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-edit',
          tool: 'edit_file',
          input: {
            path: '../manual/file.txt',
            content: 'ok',
            createIfMissing: true,
            policy: {
              operations: ['write'],
              intent: 'write manual root',
              targetRoots: ['../manual'],
              expectedEffects: ['write file'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
        tool: {
          name: 'edit_file',
          description: 'edits files',
          requiresApproval: true,
          parameters: {},
          execute: async () => ({ ok: true }),
        },
      }),
      profile,
    });
    expect(manual.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: expect.stringContaining('root requires manual approval'),
    }));

    const production = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-shell',
          tool: 'run_shell_mutate',
          input: {
            command: 'node scripts/update-sibling.js',
            policy: {
              operations: ['execute'],
              intent: 'run production-like command',
              targetRoots: ['.'],
              expectedEffects: ['execute script'],
              environment: 'production',
              confidence: 'high',
            },
          },
        },
      }),
      profile,
    });
    expect(production.decision).toEqual(expect.objectContaining({
      type: 'request',
      reason: 'environment is not allowed for unattended execution',
    }));
  });

  it('denies deterministic catastrophic shell commands regardless of envelope', () => {
    const evaluation = AutonomyPolicyService.evaluate({
      context: context({
        call: {
          id: 'call-rm',
          tool: 'run_shell_mutate',
          input: {
            command: 'rm -rf ~',
            policy: {
              operations: ['delete'],
              intent: 'cleanup temporary files',
              targetRoots: ['.'],
              expectedEffects: ['cleanup'],
              maxDestructiveScope: 'single-file',
              environment: 'local',
              confidence: 'high',
            },
          },
        },
      }),
      profile,
    });

    expect(evaluation.decision.type).toBe('deny');
    expect(evaluation.facts.hardDenyReasons).toContain('root/home recursive deletion is blocked');
  });
});
