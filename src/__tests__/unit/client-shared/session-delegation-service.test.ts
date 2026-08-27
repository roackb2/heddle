import { describe, expect, it } from 'vitest';
import {
  ClientSharedSessionDelegationService,
} from '@/client-shared/services/session-delegations/index.js';
import type { ClientSharedSessionActivity } from '@/client-shared/services/session-activities/index.js';
import type { ControlPlaneSessionTurn } from '@/client-shared/api/types.js';

describe('ClientSharedSessionDelegationService', () => {
  it('uses the Code display name for live action-capable children', () => {
    const state = ClientSharedSessionDelegationService.reduceActivity([], {
      source: 'delegation',
      type: 'delegation.started',
      rootRunId: 'run-root',
      parentRunId: 'run-root',
      delegationId: 'delegation-code',
      childRunId: 'run-code-child',
      depth: 1,
      task: 'Apply the focused change.',
      agentProfileId: 'builtin:code',
      timestamp: '2026-08-28T00:00:00.000Z',
    });

    expect(state[0]).toMatchObject({
      agentProfileId: 'builtin:code',
      agentName: 'Code',
      status: 'running',
    });
  });

  it('reduces replayed child lifecycle events into one safe live row', () => {
    const started = delegationStarted();
    let state = ClientSharedSessionDelegationService.reduceActivity([], started);
    state = ClientSharedSessionDelegationService.reduceActivity(state, started);

    expect(state).toEqual([expect.objectContaining({
      delegationId: 'delegation-1',
      agentName: 'Ask',
      task: 'Inspect the durable boundary.',
      status: 'running',
      latestActivity: { label: 'Starting' },
    })]);

    state = ClientSharedSessionDelegationService.reduceActivity(state, {
      ...delegationBase(),
      type: 'delegation.child.activity',
      activity: {
        source: 'agent-loop',
        type: 'reasoning.summary',
        runId: 'run-child-1',
        step: 1,
        text: 'Private provider progress must not be projected.',
        done: false,
        timestamp: '2026-08-27T08:00:01.000Z',
      },
    } as ClientSharedSessionActivity);

    expect(state[0]?.latestActivity).toEqual({ label: 'Thinking' });
    expect(JSON.stringify(state)).not.toContain('Private provider progress');

    state = ClientSharedSessionDelegationService.reduceActivity(state, {
      ...delegationBase(),
      type: 'delegation.finished',
      outcome: 'done',
      summary: 'Found the shared client seam.\nIt is replay safe.',
      timestamp: '2026-08-27T08:00:03.000Z',
    } as ClientSharedSessionActivity);

    expect(state).toEqual([expect.objectContaining({
      status: 'finished',
      outcome: 'done',
      summary: 'Found the shared client seam. It is replay safe.',
      startedAt: '2026-08-27T08:00:00.000Z',
      finishedAt: '2026-08-27T08:00:03.000Z',
      latestActivity: undefined,
    })]);
  });

  it('recovers a terminal row without a previously observed start and clears it for a new root run', () => {
    const recovered = ClientSharedSessionDelegationService.reduceActivity([], {
      ...delegationBase(),
      type: 'delegation.cancelled',
      outcome: 'interrupted',
      error: { code: 'child_timeout', message: 'Child exceeded its time limit.' },
      timestamp: '2026-08-27T08:00:05.000Z',
    } as ClientSharedSessionActivity);

    expect(recovered).toEqual([expect.objectContaining({
      status: 'cancelled',
      error: 'Child exceeded its time limit.',
    })]);

    expect(ClientSharedSessionDelegationService.reduceActivity(recovered, {
      source: 'agent-loop',
      type: 'loop.started',
      runId: 'run-root-2',
      goal: 'Start another turn.',
      model: 'gpt-5.6-terra',
      provider: 'openai',
      workspaceRoot: '/tmp/workspace',
      timestamp: '2026-08-27T08:01:00.000Z',
    } as ClientSharedSessionActivity)).toEqual([]);
  });

  it('projects settled records without trace, provider, or transcript fields', () => {
    const delegations: NonNullable<ControlPlaneSessionTurn['delegations']> = [settledDelegation()];

    expect(ClientSharedSessionDelegationService.projectSettled(delegations)).toEqual([{
      delegationId: 'delegation-1',
      rootRunId: 'run-root-1',
      childRunId: 'run-child-1',
      agentProfileId: 'builtin:ask',
      agentName: 'Ask',
      task: 'Inspect the durable boundary.',
      status: 'finished',
      outcome: 'done',
      summary: 'Found the shared client seam.',
      startedAt: '2026-08-27T08:00:00.000Z',
      finishedAt: '2026-08-27T08:00:03.000Z',
    }]);
  });

  it('formats stable compact durations', () => {
    expect(ClientSharedSessionDelegationService.formatDuration(
      '2026-08-27T08:00:00.000Z',
      '2026-08-27T08:01:05.000Z',
    )).toBe('1m 5s');
    expect(ClientSharedSessionDelegationService.formatDuration('invalid')).toBe('—');
  });
});

function delegationBase() {
  return {
    source: 'delegation' as const,
    rootRunId: 'run-root-1',
    parentRunId: 'run-root-1',
    delegationId: 'delegation-1',
    childRunId: 'run-child-1',
    depth: 1 as const,
    task: 'Inspect the durable boundary.',
    agentProfileId: 'builtin:ask',
  };
}

function delegationStarted(): ClientSharedSessionActivity {
  return {
    ...delegationBase(),
    type: 'delegation.started',
    timestamp: '2026-08-27T08:00:00.000Z',
  };
}

function settledDelegation(): NonNullable<ControlPlaneSessionTurn['delegations']>[number] {
  return {
    schemaVersion: 1,
    delegationId: 'delegation-1',
    rootRunId: 'run-root-1',
    parentRunId: 'run-root-1',
    childRunId: 'run-child-1',
    depth: 1,
    task: 'Inspect the durable boundary.',
    agentSnapshot: {
      agentProfileId: 'builtin:ask',
      agentName: 'Ask',
      modeAlias: 'ask',
      source: 'built-in',
      definitionHash: 'ask-definition',
      runtime: { maxSteps: 24 },
      toolProfile: { preset: 'inspect', memoryMode: 'none' },
      approvalProfile: { preset: 'read_only' },
      systemContextAppendix: 'Read only.',
    },
    status: 'finished',
    outcome: 'done',
    summary: 'Found the shared client seam.',
    startedAt: '2026-08-27T08:00:00.000Z',
    finishedAt: '2026-08-27T08:00:03.000Z',
  };
}
