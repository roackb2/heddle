import type { ConversationEngineHost, ConversationSessionService } from '../../../../../core/chat/engine/types.js';
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
}): NonNullable<ConversationEngineHost['compaction']> & {
  handleWithSourceHistory: (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => void;
} {
  const { state, sessionId, sessionService, refreshSessions } = args;

  const handleWithSourceHistory = (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => {
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
  const text = formatDirectShellCompactionStatus(event);
  if (!text) {
    return;
  }

  state.setLiveEvents((current) => [
    ...current,
    { id: state.nextLocalId(), text },
  ].slice(-8));
}

function formatDirectShellCompactionStatus(event: TuiCompactionStatusEvent): string | undefined {
  const formatters = {
    running: () => 'Compacting earlier conversation history…',
    failed: () => `Compaction failed: ${event.error ?? 'unknown error'}`,
    finished: () => 'Compaction finished.',
  } satisfies Record<TuiCompactionStatusEvent['status'], () => string | undefined>;

  return formatters[event.status]();
}
