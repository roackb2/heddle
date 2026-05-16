import type { ChatTurnCompactionPort } from '../../../../../core/chat/engine/turns/host/index.js';
import type { ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import type { ChatMessage } from '../../../../../index.js';
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
}): ChatTurnCompactionPort & {
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
  const liveText = compactionLiveEventText(event);
  if (!liveText) {
    return;
  }

  state.setLiveEvents((current) => [...current, { id: state.nextLocalId(), text: liveText }].slice(-8));
}

function compactionLiveEventText(event: TuiCompactionStatusEvent): string {
  switch (event.status) {
    case 'running':
      return 'Compacting earlier conversation history…';
    case 'failed':
      return `Compaction failed: ${event.error ?? 'unknown error'}`;
    case 'finished':
      return 'Compaction finished.';
  }
}
