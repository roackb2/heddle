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
});
