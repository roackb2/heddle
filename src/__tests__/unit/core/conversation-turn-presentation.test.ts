import { describe, expect, it } from 'vitest';
import { HeddleEventType } from '@/core/event-types.js';
import { ConversationTurnPresentationService } from '@/core/chat/engine/turns/presentation/index.js';
import type { TraceEvent } from '@/core/types.js';

describe('ConversationTurnPresentationService', () => {
  it('projects approvals and edit diffs from completed turn traces', () => {
    const trace: TraceEvent[] = [
      {
        type: HeddleEventType.toolApprovalRequested,
        call: {
          id: 'approval-1',
          tool: 'run_shell_mutate',
          input: { command: 'npm run build' },
        },
        step: 1,
        timestamp: '2026-06-05T01:00:00.000Z',
      },
      {
        type: HeddleEventType.toolApprovalResolved,
        call: {
          id: 'approval-1',
          tool: 'run_shell_mutate',
          input: { command: 'npm run build' },
        },
        approved: true,
        reason: 'approved once',
        step: 1,
        timestamp: '2026-06-05T01:00:01.000Z',
      },
      {
        type: HeddleEventType.toolCompleted,
        call: {
          id: 'edit-1',
          tool: 'edit_file',
          input: { path: 'src/example.ts' },
        },
        result: {
          ok: true,
          output: {
            path: 'src/example.ts',
            action: 'replaced',
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
        step: 2,
        timestamp: '2026-06-05T01:00:02.000Z',
      },
    ];

    expect(ConversationTurnPresentationService.project({ turnId: 'turn-1', trace })).toEqual({
      timelineItems: [
        {
          type: 'approval',
          id: 'turn-1:approval:approval-1',
          toolCallId: 'approval-1',
          tool: 'run_shell_mutate',
          summary: 'run_shell_mutate (npm run build)',
          status: 'approved',
          command: 'npm run build',
          reason: 'approved once',
          step: 1,
          timestamp: '2026-06-05T01:00:01.000Z',
        },
        {
          type: 'edit_diff',
          id: 'turn-1:edit-diff:edit-1',
          toolCallId: 'edit-1',
          path: 'src/example.ts',
          action: 'replaced',
          patch: [
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
          ].join('\n'),
          truncated: false,
          step: 2,
          timestamp: '2026-06-05T01:00:02.000Z',
        },
      ],
    });
  });

  it('drops non-presentation traces and invalid stored presentation values', () => {
    const trace: TraceEvent[] = [
      {
        type: HeddleEventType.runFinished,
        outcome: 'done',
        summary: 'Done',
        step: 1,
        timestamp: '2026-06-05T01:00:00.000Z',
      },
    ];

    expect(ConversationTurnPresentationService.project({ turnId: 'turn-1', trace })).toBeUndefined();
    expect(ConversationTurnPresentationService.read({ timelineItems: [{ type: 'unknown' }] })).toBeUndefined();
  });
});
