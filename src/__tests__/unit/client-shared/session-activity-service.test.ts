import { describe, expect, it } from 'vitest';
import { ClientSharedSessionActivityService } from '../../../client-shared/services/session-activities/index.js';
import type { ControlPlaneSessionEventEnvelope } from '../../../client-shared/api/types.js';

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionEventEnvelope, { type: 'session.event' }>['activities'][number];

describe('ClientSharedSessionActivityService', () => {
  it('applies shared live status effects for web and terminal clients', () => {
    const statuses: Array<string | undefined> = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'tool.calling',
      tool: 'read_file',
      toolCallId: 'call-1',
      input: { path: 'README.md' },
      requiresApproval: false,
      step: 2,
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: new Date().toISOString(),
    } as ControlPlaneSessionActivity, {
      onLiveStatus: (_activity, liveStatus) => statuses.push(liveStatus),
    });

    ClientSharedSessionActivityService.applyActivity({
      type: 'tool.approval_resolved',
      approved: true,
      reason: 'Approved',
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: new Date().toISOString(),
    } as ControlPlaneSessionActivity, {
      onPendingApprovalChanged: () => statuses.push('approval refreshed'),
      onLiveStatus: (_activity, liveStatus) => statuses.push(liveStatus),
    });

    expect(statuses).toEqual([
      'Working... running read_file (step 2)',
      'approval refreshed',
      'Approval resolved. Resuming...',
    ]);
  });

  it('applies run and workspace effects once for lifecycle activities', () => {
    const effects: string[] = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'loop.finished',
      outcome: 'done',
      runId: 'run-1',
      source: 'agent-loop',
      summary: 'Done.',
      timestamp: new Date().toISOString(),
    } as ControlPlaneSessionActivity, {
      onRunFinished: (_activity, liveStatus) => effects.push(`finished:${liveStatus}`),
      onWorkspaceChanged: () => effects.push('workspace changed'),
    });

    expect(effects).toEqual(['finished:Run finished: done', 'workspace changed']);
  });

  it('applies plan update effects without changing live status', () => {
    const effects: string[] = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'plan.updated',
      runId: 'run-1',
      source: 'agent-loop',
      step: 1,
      timestamp: new Date().toISOString(),
      explanation: 'Tracking current work.',
      items: [
        { step: 'Inspect', status: 'completed' },
        { step: 'Implement', status: 'in_progress' },
      ],
    } as ControlPlaneSessionActivity, {
      onPlanUpdated: (plan) => effects.push(plan.items[1]?.step ?? ''),
      onLiveStatus: () => effects.push('live status changed'),
    });

    expect(effects).toEqual(['Implement']);
  });

  it('uses derived tool labels when the API provides them', () => {
    expect(ClientSharedSessionActivityService.formatToolLabel({
      type: 'tool.approval_requested',
      call: {
        id: 'call-1',
        tool: 'run_shell',
        input: { command: 'yarn test' },
      },
      derived: {
        kind: 'tool-summary',
        summary: 'yarn test',
      },
      reason: 'Needs approval',
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: new Date().toISOString(),
    } as ControlPlaneSessionActivity)).toBe('yarn test');
  });
});
