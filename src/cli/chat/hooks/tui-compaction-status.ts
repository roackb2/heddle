import type { ChatTurnCompactionPort } from '../../../core/chat/turn-host.js';
import { buildCompactionRunningContext } from '../state/compaction.js';
import type { ChatMessage } from '../../../index.js';
import type { ChatSession } from '../state/types.js';
import type { ActionState } from './useAgentRun.js';

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

export type TuiCompactionStatusEvent = {
  status: 'running' | 'finished' | 'failed';
  archivePath?: string;
  error?: string;
};

export function createTuiCompactionStatusPort(args: {
  state: ActionState;
  sessionId: string;
  updateSessionById: SessionUpdater;
}): ChatTurnCompactionPort & {
  handleWithSourceHistory: (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => void;
} {
  const { state, sessionId, updateSessionById } = args;

  const handleWithSourceHistory = (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => {
    appendCompactionLiveEvent(state, event);

    if (event.status !== 'running') {
      return;
    }

    state.setStatus('Compacting');
    updateSessionById(sessionId, (sessionToUpdate) => ({
      ...sessionToUpdate,
      history: sourceHistory,
      context: buildCompactionRunningContext({
        history: sourceHistory,
        previous: sessionToUpdate.context,
        archiveCount: sessionToUpdate.archives?.length,
        currentSummaryPath: sessionToUpdate.context?.currentSummaryPath,
        lastArchivePath: event.archivePath,
      }),
    }));
  };

  return {
    onPreflightCompactionStatus: (event) => handleWithSourceHistory(event, []),
    onFinalCompactionStatus: (event) => handleWithSourceHistory(event, []),
    handleWithSourceHistory,
  };
}

export function createTuiDirectShellCompactionStatusHandler(args: {
  state: ActionState;
  updateActiveSession: ActiveSessionUpdater;
}) {
  const { state, updateActiveSession } = args;

  return (event: TuiCompactionStatusEvent, sourceHistory: ChatMessage[]) => {
    appendCompactionLiveEvent(state, event);

    if (event.status !== 'running') {
      return;
    }

    state.setStatus('Compacting');
    updateActiveSession((session) => ({
      ...session,
      context: buildCompactionRunningContext({
        history: sourceHistory,
        previous: session.context,
        archiveCount: session.archives?.length,
        currentSummaryPath: session.context?.currentSummaryPath,
        lastArchivePath: event.archivePath,
      }),
    }));
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
