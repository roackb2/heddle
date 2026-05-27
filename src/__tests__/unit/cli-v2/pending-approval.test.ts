import { describe, expect, it } from 'vitest';
import {
  formatApprovalPayload,
  resolveApprovalDecision,
  resolveApprovalInputDetail,
  resolveAvailableApprovalChoices,
  type PendingApproval,
} from '../../../cli-v2/helpers/approvals/pending-approval.js';

describe('pending approval helpers', () => {
  it('exposes remember choice only when the API provides remember metadata', () => {
    expect(resolveAvailableApprovalChoices(createApproval())).toEqual(['approve', 'deny']);
    expect(resolveAvailableApprovalChoices(createApproval({
      rememberProjectApproval: {
        label: 'allow command for this project',
        rule: {
          tool: 'run_shell_mutate',
          mode: 'exact',
          command: 'yarn test',
          scope: 'workspace',
          capability: 'project_script',
          createdAt: '2026-05-27T00:00:00.000Z',
        },
      },
    }))).toEqual(['approve', 'allow_project', 'deny']);
  });

  it('builds API-derived approval decisions for each choice', () => {
    const approval = createApproval({
      rememberProjectApproval: {
        label: 'allow command for this project',
        rule: {
          tool: 'run_shell_mutate',
          mode: 'exact',
          command: 'yarn test',
          scope: 'workspace',
          capability: 'project_script',
          createdAt: '2026-05-27T00:00:00.000Z',
        },
      },
    });

    expect(resolveApprovalDecision('approve', approval)).toEqual({
      type: 'approve',
      reason: 'Approved in cli-v2',
    });
    expect(resolveApprovalDecision('allow_project', approval)).toEqual({
      type: 'approve_and_remember_project',
      reason: 'Approved and remembered for this project in cli-v2',
    });
    expect(resolveApprovalDecision('deny', approval)).toEqual({
      type: 'deny',
      reason: 'Denied in cli-v2',
    });
  });

  it('projects common approval input details and raw payloads', () => {
    expect(resolveApprovalInputDetail({ command: 'yarn test' })).toEqual({
      label: 'command',
      value: 'yarn test',
    });
    expect(resolveApprovalInputDetail({ path: 'src/index.ts' })).toEqual({
      label: 'path',
      value: 'src/index.ts',
    });
    expect(formatApprovalPayload({ extra: true })).toBe('{\n  "extra": true\n}');
  });
});

function createApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    tool: 'run_shell_mutate',
    callId: 'call-1',
    input: { command: 'yarn test' },
    requestedAt: '2026-05-27T00:00:00.000Z',
    summary: 'run yarn test',
    ...overrides,
  };
}
