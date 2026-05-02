import { describe, expect, it } from 'vitest';
import {
  defaultToolApprovalPolicies,
  isOutsideWorkspaceInspectionCall,
  rememberedApprovalPolicy,
} from '../../../core/approvals/default-policies.js';
import { evaluateToolApprovalPolicies } from '../../../core/approvals/policy-chain.js';
import { humanApprovalPolicy } from '../../../core/approvals/surface.js';
import type { ToolApprovalPolicyContext } from '../../../core/approvals/types.js';

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
    const seen: string[] = [];
    const decision = await evaluateToolApprovalPolicies([
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
    ], context());

    expect(decision).toEqual({ type: 'allow', reason: 'remembered' });
    expect(seen).toEqual(['abstain', 'allow']);
  });

  it('requests approval for explicit approval-gated tools', async () => {
    await expect(evaluateToolApprovalPolicies(defaultToolApprovalPolicies, context())).resolves.toEqual({
      type: 'request',
      reason: 'run_shell_mutate requires approval',
    });
  });

  it('requests approval for outside-workspace inspection paths', async () => {
    const readOutside = context({
      call: { id: 'call-1', tool: 'read_file', input: { path: '../secrets.txt' } },
      tool: {
        name: 'read_file',
        description: 'reads files',
        parameters: {},
        execute: async () => ({ ok: true }),
      },
    });

    await expect(evaluateToolApprovalPolicies(defaultToolApprovalPolicies, readOutside)).resolves.toEqual({
      type: 'request',
      reason: 'read_file targets a path outside the workspace',
    });
    expect(isOutsideWorkspaceInspectionCall(readOutside)).toBe(true);
  });

  it('abstains for normal non-approval tools', async () => {
    await expect(evaluateToolApprovalPolicies(defaultToolApprovalPolicies, context({
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
      tool: {
        name: 'read_file',
        description: 'reads files',
        parameters: {},
        execute: async () => ({ ok: true }),
      },
    }))).resolves.toBeUndefined();
  });

  it('turns remembered project approvals into allow decisions', async () => {
    const decision = await rememberedApprovalPolicy({
      isApproved: ({ call }) => call.tool === 'run_shell_mutate',
    })(context());

    expect(decision).toEqual({
      type: 'allow',
      reason: 'Approved by saved project rule',
    });
  });

  it('wraps human approval surfaces as policy decisions', async () => {
    await expect(humanApprovalPolicy(async () => ({
      approved: false,
      reason: 'Denied by human',
    }))(context())).resolves.toEqual({
      type: 'deny',
      reason: 'Denied by human',
    });
  });
});
