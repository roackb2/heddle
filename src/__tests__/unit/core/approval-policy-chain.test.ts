import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AutonomyPolicyService,
  ToolApprovalPolicies,
  ToolApprovalService,
  type AutopilotProfile,
} from '@/core/approvals/index.js';
import { ProjectApprovalRuleCodec } from '@/core/approvals/remembered-rules/index.js';
import type { ToolApprovalPolicyContext } from '@/core/approvals/types.js';

function context(overrides: Partial<ToolApprovalPolicyContext> = {}): ToolApprovalPolicyContext {
  return {
    call: { id: 'call-1', tool: 'run_shell_mutate', input: { command: 'yarn test' } },
    tool: {
      name: 'run_shell_mutate',
      description: 'mutates workspace',
      requiresApproval: true,
      parameters: {},
      execute: async () => ({ ok: true }),
    },
    workspaceRoot: '/workspace',
    ...overrides,
  };
}

describe('approval policy chain', () => {
  it('returns the first policy decision and skips later policies', async () => {
    const service = new ToolApprovalService();
    const seen: string[] = [];
    const decision = await service.evaluate({
      policies: [
      () => {
        seen.push('abstain');
        return undefined;
      },
      () => {
        seen.push('allow');
        return { type: 'allow', reason: 'remembered' };
      },
      () => {
        seen.push('deny');
        return { type: 'deny', reason: 'too late' };
      },
      ],
      context: context(),
    });

    expect(decision).toEqual({ type: 'allow', reason: 'remembered' });
    expect(seen).toEqual(['abstain', 'allow']);
  });

  it('requests approval for explicit approval-gated tools', async () => {
    const service = new ToolApprovalService();
    await expect(service.evaluate({
      policies: ToolApprovalPolicies.default(),
      context: context(),
    })).resolves.toEqual({
      type: 'request',
      reason: 'run_shell_mutate requires approval',
    });
  });

  it('requests approval for outside-workspace inspection paths', async () => {
    const service = new ToolApprovalService();
    const readOutside = context({
      call: { id: 'call-1', tool: 'read_file', input: { path: '../secrets.txt' } },
      tool: {
        name: 'read_file',
        description: 'reads files',
        parameters: {},
        execute: async () => ({ ok: true }),
      },
    });

    await expect(service.evaluate({
      policies: ToolApprovalPolicies.default(),
      context: readOutside,
    })).resolves.toEqual({
      type: 'request',
      reason: 'read_file targets a path outside the workspace',
    });
    expect(ToolApprovalPolicies.isOutsideWorkspaceInspectionCall(readOutside)).toBe(true);
  });

  it('abstains for normal non-approval tools', async () => {
    const service = new ToolApprovalService();
    await expect(service.evaluate({
      policies: ToolApprovalPolicies.default(),
      context: context({
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
      tool: {
        name: 'read_file',
        description: 'reads files',
        parameters: {},
        execute: async () => ({ ok: true }),
      },
    }),
    })).resolves.toBeUndefined();
  });

  it('turns remembered project approvals into allow decisions', async () => {
    const decision = await ToolApprovalPolicies.rememberedProjectRule({
      isApproved: ({ call }) => call.tool === 'run_shell_mutate',
    })(context());

    expect(decision).toEqual({
      type: 'allow',
      reason: 'Approved by saved project rule',
    });
  });

  it('wraps human approval surfaces as policy decisions', async () => {
    await expect(ToolApprovalPolicies.humanSurface(async () => ({
      approved: false,
      reason: 'Denied by human',
    }))(context())).resolves.toEqual({
      type: 'deny',
      reason: 'Denied by human',
    });
  });

  it('allows unattended local automation for read and edit file tools', async () => {
    const service = new ToolApprovalService();
    const editOutside = context({
      call: {
        id: 'call-edit',
        tool: 'edit_file',
        input: { path: '../heartbeat-liveness-check.txt', content: 'ok', createIfMissing: true },
      },
      tool: {
        name: 'edit_file',
        description: 'edits files',
        requiresApproval: true,
        parameters: {},
        execute: async () => ({ ok: true }),
      },
    });

    await expect(service.resolve({
      policies: [
        ...ToolApprovalPolicies.default(),
        ToolApprovalPolicies.unattendedLocalAutomation(),
      ],
      context: editOutside,
      requestHumanApproval: async () => ({ approved: false, reason: 'should not request human approval' }),
    })).resolves.toEqual({
      approved: true,
      reason: 'Allowed for unattended local automation',
    });
  });

  it('blocks catastrophically dangerous shell commands for unattended local automation', async () => {
    const service = new ToolApprovalService();

    await expect(service.resolve({
      policies: [
        ...ToolApprovalPolicies.default(),
        ToolApprovalPolicies.unattendedLocalAutomation(),
      ],
      context: context({
        call: { id: 'call-rm', tool: 'run_shell_mutate', input: { command: 'rm -rf ~' } },
      }),
      requestHumanApproval: async () => ({ approved: true, reason: 'should not request human approval' }),
    })).resolves.toEqual({
      approved: false,
      reason: 'Command not allowed. This command appears catastrophically destructive (home/root/disk-level) and is blocked even in approval-gated mutate mode.',
    });
  });

  it('lets autopilot satisfy an earlier approval request when the declared envelope is allowed', async () => {
    const service = new ToolApprovalService();
    const human = vi.fn(async () => ({ approved: false, reason: 'should not request human approval' }));
    const profile: AutopilotProfile = {
      mode: 'autopilot',
      roots: [{
        path: '.',
        access: 'autopilot',
        allow: ['read', 'write', 'execute', 'verification'],
      }],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };

    await expect(service.resolve({
      policies: [
        ...ToolApprovalPolicies.default(),
        ToolApprovalPolicies.autopilot({ profile }),
      ],
      context: context({
        call: {
          id: 'call-test',
          tool: 'run_shell_mutate',
          input: {
            command: 'yarn test',
            policy: {
              operations: ['execute'],
              intent: 'run local tests',
              targetRoots: ['.'],
              expectedEffects: ['run test suite'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
      }),
      requestHumanApproval: human,
    })).resolves.toEqual(expect.objectContaining({
      approved: true,
      reason: 'allowed by autopilot profile and declared policy envelope',
      autonomyEvaluation: expect.objectContaining({
        decision: expect.objectContaining({ type: 'allow' }),
      }),
    }));
    expect(human).not.toHaveBeenCalled();
  });

  it('lets autopilot deny unsafe commands without falling through to human approval', async () => {
    const service = new ToolApprovalService();
    const human = vi.fn(async () => ({ approved: true, reason: 'should not request human approval' }));
    const profile: AutopilotProfile = {
      mode: 'autopilot',
      roots: [{
        path: '.',
        access: 'autopilot',
        allow: ['read', 'write', 'execute'],
      }],
      environments: {
        allow: ['local', 'dev'],
        requireApproval: ['staging', 'production', 'unknown'],
      },
    };

    await expect(service.resolve({
      policies: [
        ...ToolApprovalPolicies.default(),
        ToolApprovalPolicies.autopilot({ profile }),
      ],
      context: context({
        call: {
          id: 'call-rm',
          tool: 'run_shell_mutate',
          input: {
            command: 'rm -rf ~',
            policy: {
              operations: ['delete'],
              intent: 'cleanup',
              targetRoots: ['.'],
              expectedEffects: ['cleanup'],
              environment: 'local',
              confidence: 'high',
            },
          },
        },
      }),
      requestHumanApproval: human,
    })).resolves.toEqual(expect.objectContaining({
      approved: false,
      reason: 'root/home recursive deletion is blocked',
      autonomyEvaluation: expect.objectContaining({
        decision: expect.objectContaining({ type: 'deny' }),
      }),
    }));
    expect(human).not.toHaveBeenCalled();
  });

  it('lets remembered outside-workspace read_file approvals satisfy request policies before human approval', async () => {
    const service = new ToolApprovalService();
    const human = vi.fn(async () => ({ approved: false, reason: 'should not run' }));
    const readOutside = context({
      call: { id: 'call-1', tool: 'read_file', input: { path: '../notes/summary.md' } },
      tool: {
        name: 'read_file',
        description: 'reads files',
        parameters: {},
        execute: async () => ({ ok: true }),
      },
    });

    await expect(service.resolve({
      policies: [
        ...ToolApprovalPolicies.default(),
        ToolApprovalPolicies.rememberedProjectRule({
          isApproved: ({ call }) => call.tool === 'read_file',
        }),
      ],
      context: readOutside,
      requestHumanApproval: human,
    })).resolves.toEqual({
      approved: true,
      reason: 'Approved by saved project rule',
    });
    expect(human).not.toHaveBeenCalled();
  });

  it('lets later allow policies satisfy earlier request policies before human approval', async () => {
    const service = new ToolApprovalService();
    const human = vi.fn(async () => ({ approved: false, reason: 'should not run' }));

    await expect(service.resolve({
      policies: [
        () => ({ type: 'request', reason: 'run_shell_mutate requires approval' }),
        ToolApprovalPolicies.rememberedProjectRule({
          isApproved: ({ call }) => call.tool === 'run_shell_mutate',
        }),
      ],
      context: context(),
      requestHumanApproval: human,
    })).resolves.toEqual({
      approved: true,
      reason: 'Approved by saved project rule',
    });
    expect(human).not.toHaveBeenCalled();
  });

  it('falls through to human approval when a request policy is not satisfied', async () => {
    const service = new ToolApprovalService();
    const human = vi.fn(async (_context: ToolApprovalPolicyContext, reason?: string) => ({
      approved: true,
      reason: `human approved: ${reason}`,
    }));

    await expect(service.resolve({
      policies: [
        () => ({ type: 'request', reason: 'run_shell_mutate requires approval' }),
      ],
      context: context(),
      requestHumanApproval: human,
    })).resolves.toEqual({
      approved: true,
      reason: 'human approved: run_shell_mutate requires approval',
    });
    expect(human).toHaveBeenCalledTimes(1);
  });

  it('creates a host-neutral approval request with summary, reason, preview, and remembered rule metadata', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-approval-service-'));
    writeFileSync(join(workspaceRoot, 'README.md'), 'old text\n');
    const service = new ToolApprovalService({
      workspaceRoot,
      now: () => new Date('2026-05-22T10:00:00.000Z'),
    });
    const request = await service.createRequest(context({
      call: {
        id: 'call-edit',
        tool: 'edit_file',
        input: { path: 'README.md', oldText: 'old text', newText: 'new text' },
      },
      tool: {
        name: 'edit_file',
        description: 'edits files',
        requiresApproval: true,
        parameters: {},
        execute: async () => ({ ok: true }),
      },
      workspaceRoot,
      reason: 'edit_file requires approval',
    }));

    expect(request).toEqual(expect.objectContaining({
      tool: 'edit_file',
      callId: 'call-edit',
      input: { path: 'README.md', oldText: 'old text', newText: 'new text' },
      requestedAt: '2026-05-22T10:00:00.000Z',
      summary: 'edit_file (README.md)',
      reason: 'edit_file requires approval',
    }));
    expect(request.editPreview?.path).toBe('README.md');
    expect(request.rememberProjectApproval?.label).toBe('allow edit_file for this project');
  });

  it('adds an Auto repo expansion option when autonomy requests approval for a sibling project root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-auto-approval-'));
    const workspaceRoot = join(root, 'heddle');
    const siblingRoot = join(root, 'heddle-workspace-notes');
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
    mkdirSync(join(siblingRoot, '.git'), { recursive: true });
    writeFileSync(join(siblingRoot, 'README.md'), '# notes\n');

    const approvalContext = context({
      call: {
        id: 'call-read',
        tool: 'read_file',
        input: { path: '../heddle-workspace-notes/README.md' },
      },
      tool: {
        name: 'read_file',
        description: 'reads files',
        requiresApproval: false,
        parameters: {},
        execute: async () => ({ ok: true }),
      },
      workspaceRoot,
    });
    const autonomyEvaluation = AutonomyPolicyService.evaluate({
      context: approvalContext,
      profile: {
        mode: 'autopilot',
        preset: 'auto',
        roots: [
          { path: '.', access: 'autopilot', allow: ['read', 'write', 'execute'] },
          { path: root, access: 'manual-only' },
        ],
        environments: {
          allow: ['local', 'dev'],
          requireApproval: ['staging', 'production', 'unknown'],
        },
      },
    });

    const request = await new ToolApprovalService({ workspaceRoot }).createRequest({
      ...approvalContext,
      reason: autonomyEvaluation.decision.reason,
      autonomyEvaluation,
    });

    expect(request.autopilotRootApproval).toEqual(expect.objectContaining({
      label: 'Trust this repo',
      root: siblingRoot,
      relativeRoot: '../heddle-workspace-notes',
      access: 'autopilot',
    }));
  });

  it('resolves approve-and-remember decisions through the existing project approval repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-service-'));
    const rulesFile = join(root, 'command-approvals.json');
    const service = new ToolApprovalService({ projectApprovalRulesFile: rulesFile });
    const approvalContext = context();

    expect(service.resolveUserDecision({
      context: approvalContext,
      decision: { type: 'approve_and_remember_project', reason: 'remember it' },
    })).toEqual({
      approved: true,
      reason: 'remember it',
    });

    expect(service.isApprovedByRememberedProjectRule(approvalContext)).toBe(true);
    expect(ProjectApprovalRuleCodec.parseList(JSON.parse(readFileSync(rulesFile, 'utf8')) as unknown)).toHaveLength(1);
  });
});
