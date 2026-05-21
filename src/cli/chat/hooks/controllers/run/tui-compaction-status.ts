import type { ConversationEngineHost, ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import type { ChatMessage } from '../../../../../index.js';
import { ConversationActivityProjector } from '@/core/chat/engine/live/index.js';
import { formatConversationActivityForTui } from '../../../adapters/conversation-activity-adapter.js';
import type { ActionState } from '../useAgentRunController.js';

export type TuiCompactionStatusEvent = {
  status: 'running' | 'finished' | 'failed';
  archivePath?: string;
  error?: string;
};

export function createTuiCompactionStatusPort(args: {
  state: ActionState;
  sessionId: string;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
}): NonNullable<ConversationEngineHost['compaction']> & {
  handleWithSourceHistory: (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => void;
} {
  const { state, sessionId, sessionService, refreshSessions } = args;

  const handleWithSourceHistory = (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => {
    appendCompactionLiveEvent(state, event);

    if (event.status !== 'running') {
      return;
    }

    state.setStatus('Compacting');
    sessionService.markCompactionRunning(sessionId, {
      sourceHistory,
      archivePath: event.archivePath,
    });
    refreshSessions();
  };

  return {
    onPreflightCompactionStatus: (event: TuiCompactionStatusEvent) => handleWithSourceHistory(event, []),
    onFinalCompactionStatus: (event: TuiCompactionStatusEvent) => handleWithSourceHistory(event, []),
    handleWithSourceHistory,
  };
}

export function createTuiDirectShellCompactionStatusHandler(args: {
  state: ActionState;
  sessionId: string;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
}) {
  const { state, sessionId, sessionService, refreshSessions } = args;

  return (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => {
    appendCompactionLiveEvent(state, event);

    if (event.status !== 'running') {
      return;
    }

    state.setStatus('Compacting');
    sessionService.markCompactionRunning(sessionId, {
      sourceHistory,
      archivePath: event.archivePath,
    });
    refreshSessions();
  };
}

function appendCompactionLiveEvent(state: ActionState, event: TuiCompactionStatusEvent) {
  const liveEvents = ConversationActivityProjector.fromCompactionStatus(event)
    .map(formatConversationActivityForTui)
    .filter((text): text is string => Boolean(text));
  if (liveEvents.length === 0) {
    return;
  }

  state.setLiveEvents((current) => [
    ...current,
    ...liveEvents.map((text) => ({ id: state.nextLocalId(), text })),
  ].slice(-8));
}
