import { describe, expect, it } from 'vitest';
import { AutonomyPostflightAuditService, type AutonomyEvaluation } from '@/core/approvals/index.js';

function evaluation(overrides: Partial<AutonomyEvaluation> = {}): AutonomyEvaluation {
  return {
    call: {
      id: 'call-1',
      tool: 'edit_file',
      input: {
        path: 'src/index.ts',
        content: 'updated',
        policy: {
          operations: ['write'],
          intent: 'Update a source file.',
          targetRoots: ['.'],
          writeRoots: ['.'],
          expectedEffects: ['one source file changes'],
          maxDestructiveScope: 'single-file',
          environment: 'local',
          confidence: 'high',
        },
      },
    },
    profileMode: 'autopilot',
    envelope: {
      operations: ['write'],
      intent: 'Update a source file.',
      targetRoots: ['.'],
      writeRoots: ['.'],
      expectedEffects: ['one source file changes'],
      maxDestructiveScope: 'single-file',
      environment: 'local',
      confidence: 'high',
    },
    facts: {
      tool: 'edit_file',
      operations: ['write'],
      cwd: '/workspace/current',
      claimedReadRoots: ['/workspace/current'],
      claimedWriteRoots: ['/workspace/current'],
      resolvedKnownTargets: ['/workspace/current/src/index.ts'],
      rootDecisions: [{
        root: '/workspace/current',
        access: 'autopilot',
        matchedPolicyPath: '/workspace/current',
      }],
      hardDenyReasons: [],
      approvalReasons: [],
      claimMismatches: [],
    },
    decision: {
      type: 'allow',
      reason: 'allowed by autopilot profile and declared policy envelope',
      facts: {
        tool: 'edit_file',
        operations: ['write'],
        cwd: '/workspace/current',
        claimedReadRoots: ['/workspace/current'],
        claimedWriteRoots: ['/workspace/current'],
        resolvedKnownTargets: ['/workspace/current/src/index.ts'],
        rootDecisions: [],
        hardDenyReasons: [],
        approvalReasons: [],
        claimMismatches: [],
      },
    },
    policyHints: [],
    ...overrides,
  };
}

describe('AutonomyPostflightAuditService', () => {
  it('continues when observed changed paths stay within declared write roots', () => {
    const audit = AutonomyPostflightAuditService.create({
      evaluation: evaluation(),
      result: {
        ok: true,
        output: {
          path: 'src/index.ts',
          action: 'replaced',
        },
      },
    });

    expect(audit.decision).toBe('continue');
    expect(audit.observedEffects).toEqual({
      changedPaths: ['/workspace/current/src/index.ts'],
      changedRoots: ['/workspace/current'],
      exceededDeclaredRoots: [],
      gitHistoryChanged: false,
    });
    expect(audit.reason).toBe('observed changes stayed within declared write roots');
  });

  it('stops when structured tool output reports a changed path outside declared roots', () => {
    const audit = AutonomyPostflightAuditService.create({
      evaluation: evaluation(),
      result: {
        ok: true,
        output: {
          path: '../sibling/src/index.ts',
          action: 'replaced',
        },
      },
    });

    expect(audit.decision).toBe('stop');
    expect(audit.observedEffects.exceededDeclaredRoots).toEqual(['/workspace/sibling/src/index.ts']);
    expect(audit.reason).toContain('observed changes exceeded declared write roots');
  });

  it('stops when the command mutates git history', () => {
    const audit = AutonomyPostflightAuditService.create({
      evaluation: evaluation({
        call: {
          id: 'call-shell',
          tool: 'run_shell_mutate',
          input: {
            command: 'git commit -m "checkpoint"',
            policy: {
              operations: ['git'],
              intent: 'Create a commit.',
              targetRoots: ['.'],
              writeRoots: ['.'],
              expectedEffects: ['git history changes'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
        facts: {
          ...evaluation().facts,
          tool: 'run_shell_mutate',
          operations: ['git'],
          command: 'git commit -m "checkpoint"',
        },
      }),
      result: {
        ok: true,
        output: {
          command: 'git commit -m "checkpoint"',
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
      },
    });

    expect(audit.decision).toBe('stop');
    expect(audit.observedEffects.gitHistoryChanged).toBe(true);
    expect(audit.reason).toBe('observed git history mutation from command text');
  });
});
