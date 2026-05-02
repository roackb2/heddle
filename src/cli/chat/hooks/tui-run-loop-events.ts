import type { TraceEvent } from '../../../index.js';
import { projectTraceEventToConversationActivities } from '../../../core/observability/conversation-activity.js';
import { previewEditFileInput } from '../../../core/tools/edit-file.js';
import { formatConversationActivityForTui, formatEditPreviewHistoryMessage, formatPlanHistoryMessage } from '../utils/format.js';
import type { ChatSession } from '../state/types.js';
import type { ActionState } from './useAgentRun.js';

export type TuiAssistantStreamUpdate = { step: number; text: string; done: boolean };

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

type PlanStateParser = (output: unknown) => ActionState extends { setCurrentPlan: (value: infer T) => void } ? T : never;

export function createTuiRunLoopEventAdapter(args: {
  state: ActionState;
  sessionId: string;
  updateSessionById: SessionUpdater;
  parsePlanState: PlanStateParser;
}) {
  const { state, sessionId, updateSessionById, parsePlanState } = args;
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
          updateSessionById(sessionId, (session) => ({
            ...session,
            messages: [
              ...session.messages,
              {
                id: state.nextLocalId(),
                role: 'assistant',
                text: formatEditPreviewHistoryMessage(preview),
              },
            ],
          }));
        });
      }

      if (event.type === 'tool.result' && event.tool === 'update_plan') {
        state.setCurrentPlan(parsePlanState(event.result.output));

        if (!appendedPlanSteps.has(event.step)) {
          const renderedPlan = formatPlanHistoryMessage(event.result.output);
          if (renderedPlan) {
            appendedPlanSteps.add(event.step);
            updateSessionById(sessionId, (session) => ({
              ...session,
              messages: [
                ...session.messages,
                {
                  id: state.nextLocalId(),
                  role: 'assistant',
                  text: renderedPlan,
                },
              ],
            }));
          }
        }
      }

      const nextEvents = projectTraceEventToConversationActivities(event)
        .map(formatConversationActivityForTui)
        .filter((text): text is string => Boolean(text));
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
    },
  };
}
