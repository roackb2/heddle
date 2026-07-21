import { describe, expect, it } from 'vitest';
import { ClientSharedSessionActivityService } from '../../../client-shared/services/session-activities/index.js';
import type { ControlPlaneSessionRunEventEnvelope } from '../../../client-shared/api/types.js';

type ControlPlaneSessionActivity = Extract<ControlPlaneSessionRunEventEnvelope, { kind: 'activity' }>['activity'];

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

  it('applies run effects for direct shell activities', () => {
    const effects: string[] = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'direct_shell.started',
      source: 'direct-shell',
      runId: 'run-1',
      command: 'echo hello',
      tool: 'run_shell_inspect',
      timestamp: '2026-06-01T00:00:00.000Z',
    } as ControlPlaneSessionActivity, {
      onRunStarted: (_activity, liveStatus) => effects.push(`started:${liveStatus}`),
      onCurrentActivityChanged: (activity) => effects.push(activity?.label ?? 'cleared'),
    });

    ClientSharedSessionActivityService.applyActivity({
      type: 'direct_shell.completed',
      source: 'direct-shell',
      runId: 'run-1',
      command: 'echo hello',
      tool: 'run_shell_inspect',
      result: { ok: true },
      durationMs: 12,
      timestamp: '2026-06-01T00:00:01.000Z',
    } as ControlPlaneSessionActivity, {
      onRunFinished: (_activity, liveStatus) => effects.push(`finished:${liveStatus}`),
      onCurrentActivityChanged: (activity) => effects.push(activity?.label ?? 'cleared'),
      onWorkspaceChanged: () => effects.push('workspace changed'),
    });

    expect(effects).toEqual([
      'Running shell',
      'started:Running direct shell command...',
      'cleared',
      'finished:Direct shell finished in 12ms',
      'workspace changed',
    ]);
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

  it('delivers raw reasoning-summary progress for each frontend to present', () => {
    let summary: { text: string; done: boolean; liveStatus: string | undefined } | undefined;

    ClientSharedSessionActivityService.applyActivity({
      type: 'reasoning.summary',
      runId: 'run-1',
      source: 'agent-loop',
      step: 1,
      text: 'Inspecting the project structure.',
      done: false,
      timestamp: '2026-06-03T00:00:00.000Z',
    } as ControlPlaneSessionActivity, {
      onReasoningSummary: (activity, liveStatus) => {
        summary = { text: activity.text, done: activity.done, liveStatus };
      },
    });

    expect(summary).toEqual({
      text: 'Inspecting the project structure.',
      done: false,
      liveStatus: 'Thinking...',
    });
  });

  it('projects recent edit diffs from successful edit_file completions', () => {
    const diffs: string[] = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'tool.completed',
      tool: 'edit_file',
      toolCallId: 'call-1',
      result: {
        ok: true,
        output: {
          path: 'src/example.ts',
          action: 'replace',
          diff: {
            diff: [
              '--- a/src/example.ts',
              '+++ b/src/example.ts',
              '@@ -1 +1 @@',
              '-old',
              '+new',
            ].join('\n'),
            truncated: false,
          },
        },
      },
      durationMs: 4,
      step: 3,
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: '2026-06-03T00:00:00.000Z',
    } as ControlPlaneSessionActivity, {
      onRecentEditDiff: (diff) => diffs.push(`${diff.id}:${diff.path}:${diff.action}:${diff.step}:${diff.patch}`),
    });

    expect(diffs).toEqual([
      `run-1:call-1:src/example.ts:replace:3:${[
        '--- a/src/example.ts',
        '+++ b/src/example.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n')}`,
    ]);
  });

  it('does not project recent edit diffs from shell or failed edit_file completions', () => {
    const diffs: string[] = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'tool.completed',
      tool: 'run_shell',
      toolCallId: 'call-1',
      result: { ok: true },
      durationMs: 4,
      step: 1,
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: '2026-06-03T00:00:00.000Z',
    } as ControlPlaneSessionActivity, {
      onRecentEditDiff: (diff) => diffs.push(diff.path),
    });

    ClientSharedSessionActivityService.applyActivity({
      type: 'tool.completed',
      tool: 'edit_file',
      toolCallId: 'call-2',
      result: { ok: false },
      durationMs: 4,
      step: 2,
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: '2026-06-03T00:00:01.000Z',
    } as ControlPlaneSessionActivity, {
      onRecentEditDiff: (diff) => diffs.push(diff.path),
    });

    expect(diffs).toEqual([]);
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

  it('projects current agent activity and elapsed time from session events', () => {
    const currentActivity: string[] = [];

    ClientSharedSessionActivityService.applyActivity({
      type: 'loop.started',
      runId: 'run-1',
      source: 'agent-loop',
      goal: 'Inspect repo.',
      model: 'gpt-5.4',
      provider: 'openai',
      workspaceRoot: '/repo',
      timestamp: '2026-05-31T07:00:00.000Z',
    } as ControlPlaneSessionActivity, {
      onCurrentActivityChanged: (activity) => currentActivity.push(activity?.label ?? 'cleared'),
    });
    ClientSharedSessionActivityService.applyActivity({
      type: 'tool.calling',
      tool: 'read_file',
      toolCallId: 'call-1',
      input: { path: 'README.md' },
      requiresApproval: false,
      step: 2,
      runId: 'run-1',
      source: 'agent-loop',
      timestamp: '2026-05-31T07:00:05.000Z',
      derived: {
        kind: 'tool-summary',
        summary: 'read_file README.md',
      },
    } as ControlPlaneSessionActivity, {
      onCurrentActivityChanged: (activity) => currentActivity.push(
        activity?.detail ? `${activity.label}:${activity.detail}` : (activity?.label ?? 'cleared'),
      ),
    });
    ClientSharedSessionActivityService.applyActivity({
      type: 'assistant.stream',
      runId: 'run-1',
      source: 'agent-loop',
      step: 2,
      text: 'Final answer streaming',
      done: false,
      timestamp: '2026-05-31T07:00:07.000Z',
    } as ControlPlaneSessionActivity, {
      onCurrentActivityChanged: (activity) => currentActivity.push(activity?.label ?? 'cleared'),
    });
    ClientSharedSessionActivityService.applyActivity({
      type: 'loop.finished',
      outcome: 'done',
      runId: 'run-1',
      source: 'agent-loop',
      summary: 'Done.',
      timestamp: '2026-05-31T07:00:10.000Z',
    } as ControlPlaneSessionActivity, {
      onCurrentActivityChanged: (activity) => currentActivity.push(activity?.label ?? 'cleared'),
    });

    expect(currentActivity).toEqual(['Thinking', 'Running read_file:step 2', 'cleared', 'cleared']);
    expect(ClientSharedSessionActivityService.formatElapsed(
      '2026-05-31T07:00:05.000Z',
      new Date('2026-05-31T07:01:09.000Z'),
    )).toBe('1m 4s');
  });
});
