import { describe, expect, it } from 'vitest';
import { ClientSharedSessionTurnPresentationService } from '@/client-shared/services/session-turn-presentation/index.js';
import type { ControlPlaneSessionDetail } from '@/client-shared/api/types.js';

describe('ClientSharedSessionTurnPresentationService', () => {
  it('projects persisted turn activities with turn context', () => {
    const session = {
      id: 'session-1',
      name: 'Session 1',
      messageCount: 0,
      turnCount: 1,
      queuedPromptCount: 0,
      messages: [],
      queuedPrompts: [],
      turns: [
        {
          id: 'turn-1',
          prompt: 'Update docs',
          outcome: 'done',
          summary: 'Updated docs',
          steps: 2,
          traceFile: '/tmp/trace.json',
          events: [],
          presentation: {
            timelineItems: [
              {
                type: 'approval',
                id: 'turn-1:approval:call-1',
                toolCallId: 'call-1',
                tool: 'run_shell_mutate',
                summary: 'run_shell_mutate (npm run build)',
                status: 'approved',
                command: 'npm run build',
                timestamp: '2026-06-05T01:00:00.000Z',
              },
            ],
          },
        },
      ],
    } satisfies ControlPlaneSessionDetail;

    expect(ClientSharedSessionTurnPresentationService.projectTurnActivities(session)).toEqual([
      {
        id: 'turn-1:approval:call-1',
        turnId: 'turn-1',
        turnPrompt: 'Update docs',
        activity: session.turns[0]?.presentation?.timelineItems[0],
      },
    ]);
  });

  it('projects turn activities into the conversation timeline after the matching prompt', () => {
    const session = createSessionDetail({
      messages: [
        { id: 'message-1', role: 'user', text: 'Update docs' },
        { id: 'message-2', role: 'assistant', text: 'Done.' },
      ],
      turns: [
        createTurn({
          id: 'turn-1',
          prompt: 'Update docs',
          presentation: {
            timelineItems: [
              {
                type: 'edit_diff',
                id: 'turn-1:edit:call-1',
                toolCallId: 'call-1',
                path: 'docs/index.md',
                action: 'replace',
                patch: '@@ -1 +1 @@\n-old\n+new',
                truncated: false,
              },
            ],
          },
        }),
      ],
    });

    expect(ClientSharedSessionTurnPresentationService.projectConversationTimeline(session).map((item) => item.id)).toEqual([
      'message-1',
      'turn-1:activity-group',
      'message-2',
    ]);

    const activityGroup = ClientSharedSessionTurnPresentationService
      .projectConversationTimeline(session)
      .find((item) => item.type === 'turn_activity_group');
    expect(activityGroup?.activities).toHaveLength(1);
  });

  it('keeps unmatched turn activities visible at the end of the timeline', () => {
    const session = createSessionDetail({
      messages: [{ id: 'message-1', role: 'assistant', text: 'Done.' }],
      turns: [
        createTurn({
          id: 'turn-1',
          prompt: 'Update docs',
          presentation: {
            timelineItems: [
              {
                type: 'approval',
                id: 'turn-1:approval:call-1',
                toolCallId: 'call-1',
                tool: 'run_shell_mutate',
                summary: 'run_shell_mutate (npm run build)',
                status: 'approved',
              },
            ],
          },
        }),
      ],
    });

    expect(ClientSharedSessionTurnPresentationService.projectConversationTimeline(session).map((item) => item.id)).toEqual([
      'message-1',
      'turn-1:activity-group',
    ]);
  });
});

function createSessionDetail(
  overrides: Partial<NonNullable<ControlPlaneSessionDetail>> = {},
): NonNullable<ControlPlaneSessionDetail> {
  return {
    id: 'session-1',
    name: 'Session 1',
    messageCount: 0,
    turnCount: 0,
    queuedPromptCount: 0,
    messages: [],
    queuedPrompts: [],
    turns: [],
    ...overrides,
  };
}

function createTurn(
  overrides: Partial<NonNullable<ControlPlaneSessionDetail>['turns'][number]> = {},
): NonNullable<ControlPlaneSessionDetail>['turns'][number] {
  return {
    id: 'turn-1',
    prompt: 'Update docs',
    outcome: 'done',
    summary: 'Updated docs',
    steps: 2,
    traceFile: '/tmp/trace.json',
    events: [],
    ...overrides,
  };
}
