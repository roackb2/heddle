import { describe, expect, it } from 'vitest';
import {
  PendingApprovalService,
  type PendingApproval,
} from '../../../cli-v2/services/approvals/pending-approval-service.js';

describe('PendingApprovalService', () => {
  it('exposes remember choice only when the API provides remember metadata', () => {
    expect(PendingApprovalService.resolveAvailableChoices(createApproval())).toEqual(['approve', 'deny']);
    expect(PendingApprovalService.resolveAvailableChoices(createApproval({
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

    expect(PendingApprovalService.resolveDecision('approve', approval)).toEqual({
      type: 'approve',
      reason: 'Approved in cli-v2',
    });
    expect(PendingApprovalService.resolveDecision('allow_project', approval)).toEqual({
      type: 'approve_and_remember_project',
      reason: 'Approved and remembered for this project in cli-v2',
    });
    expect(PendingApprovalService.resolveDecision('deny', approval)).toEqual({
      type: 'deny',
      reason: 'Denied in cli-v2',
    });
  });

  it('projects common approval input details and raw payloads', () => {
    expect(PendingApprovalService.resolveInputDetail({ command: 'yarn test' })).toEqual({
      label: 'command',
      value: 'yarn test',
    });
    expect(PendingApprovalService.resolveInputDetail({ path: 'src/index.ts' })).toEqual({
      label: 'path',
      value: 'src/index.ts',
    });
    expect(PendingApprovalService.formatPayload({ extra: true })).toBe('{\n  "extra": true\n}');
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
