import type { TraceEvent } from '../../../../../index.js';
import type { ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import type { ConversationActivity } from '@/core/chat/engine/live/index.js';
import { previewEditFileInput } from '../../../../../core/tools/toolkits/coding-files/edit-file.js';
import { formatTuiConversationActivity } from '../../../adapters/conversation-activity-format.js';
import { formatEditPreviewHistoryMessage, formatPlanHistoryMessage } from '../../../utils/format.js';
import type { ActionState } from '../useAgentRunController.js';

export type TuiAssistantStreamUpdate = { step: number; text: string; done: boolean };

type PlanStateParser = (output: unknown) => ActionState extends { setCurrentPlan: (value: infer T) => void } ? T : never;

export function createTuiRunLoopEventAdapter(args: {
  state: ActionState;
  sessionId: string;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  parsePlanState: PlanStateParser;
}) {
  const { state, sessionId, sessionService, refreshSessions, parsePlanState } = args;
  const appendedEditPreviewIds = new Set<string>();
  const appendedPlanSteps = new Set<number>();
  const streamingBuffers = new Map<number, string>();

  return {
    onAssistantStream(update: TuiAssistantStreamUpdate) {
      streamingBuffers.set(update.step, update.text);
      state.setCurrentAssistantText(update.text || undefined);
      if (update.done) {
        streamingBuffers.delete(update.step);
      }
    },

    onActivity(activity: ConversationActivity) {
      appendLiveEvents(state, [formatTuiConversationActivity(activity)].filter((text): text is string => Boolean(text)));
    },

    onTraceEvent(event: TraceEvent) {
      if (event.type === 'assistant.turn' && event.content.trim()) {
        streamingBuffers.delete(event.step);
        state.setCurrentAssistantText(event.content);
      }

      if (event.type === 'tool.call' && event.call.tool === 'edit_file') {
        void previewEditFileInput(event.call.input).then((preview) => {
          if (!preview || appendedEditPreviewIds.has(event.call.id)) {
            return;
          }

          appendedEditPreviewIds.add(event.call.id);
          appendAssistantMessage({
            sessionService,
            refreshSessions,
            sessionId,
            id: state.nextLocalId(),
            text: formatEditPreviewHistoryMessage(preview),
          });
        });
      }

      if (event.type === 'tool.result' && event.tool === 'update_plan') {
        state.setCurrentPlan(parsePlanState(event.result.output));

        if (!appendedPlanSteps.has(event.step)) {
          const renderedPlan = formatPlanHistoryMessage(event.result.output);
          if (renderedPlan) {
            appendedPlanSteps.add(event.step);
            appendAssistantMessage({
              sessionService,
              refreshSessions,
              sessionId,
              id: state.nextLocalId(),
              text: renderedPlan,
            });
          }
        }
      }

    },
  };
}

function appendAssistantMessage(args: {
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  sessionId: string;
  id: string;
  text: string;
}) {
  args.sessionService.appendMessage(args.sessionId, {
    id: args.id,
    role: 'assistant',
    text: args.text,
  });
  args.refreshSessions();
}

function appendLiveEvents(state: ActionState, nextEvents: string[]) {
  if (nextEvents.length === 0) {
    return;
  }

  state.setLiveEvents((current) => {
    const dedupedNextEvents = nextEvents.filter((next) => current[current.length - 1]?.text !== next);

    return [
      ...current,
      ...dedupedNextEvents.map((text) => ({ id: state.nextLocalId(), text })),
    ].slice(-8);
  });
}
