import type { RunResult } from '../../../../../index.js';
import type { ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import { estimateChatHistoryTokens } from '../../../state/compaction.js';
import type { ChatSession } from '../../../state/types.js';
import { formatChatFailureMessage } from '../../../utils/format.js';
import type { ActionState } from '../useAgentRunController.js';

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

export function adaptPersistedTuiOrdinaryTurn(args: {
  session: ChatSession;
  displayText?: string;
  outcome: RunResult['outcome'];
}): ChatSession {
  const { session, displayText, outcome } = args;

  return {
    ...session,
    messages: session.messages.map((message, index, messages) => {
      if (displayText && message.role === 'user' && index === messages.length - 2) {
        return { ...message, text: displayText };
      }

      if (outcome !== 'done' && message.role === 'assistant' && index === messages.length - 1) {
        return { ...message, text: `Run stopped: ${message.text}` };
      }

      return message;
    }),
  };
}

export function finalizeSuccessfulTuiOrdinaryTurn(args: {
  persistedSession: ChatSession;
  displayText?: string;
  outcome: RunResult['outcome'];
  prompt: string;
  sessionId: string;
  state: ActionState;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  updateSessionById: SessionUpdater;
}) {
  const {
    persistedSession,
    displayText,
    outcome,
    prompt,
    sessionId,
    state,
    maybeAutoNameSession,
    updateSessionById,
  } = args;

  const sessionAfter = adaptPersistedTuiOrdinaryTurn({
    session: persistedSession,
    displayText,
    outcome,
  });
  const latestTurn = sessionAfter.turns.at(-1);
  const latestHistory = sessionAfter.history ?? [];
  const summaryText = latestTurn?.summary ?? sessionAfter.messages.at(-1)?.text ?? '';

  state.setCurrentAssistantText(undefined);
  maybeAutoNameSession(sessionId, prompt, summaryText);
  state.setStatus(outcome === 'done' ? 'Idle' : `Stopped: ${outcome}`);

  if (outcome === 'error') {
    state.setError(summaryText);
  }

  // Desired shape: ConversationTurnService should return the display-adapted
  // session, or own this final TUI display patch, so the host does not replace
  // a persisted turn result through a generic session updater.
  updateSessionById(sessionId, () => sessionAfter);

  return {
    session: sessionAfter,
    summaryText,
    latestHistory,
  };
}

export async function applyTuiAgentTurnFailure(args: {
  error: unknown;
  promptHistory: RunResult['transcript'];
  model: string;
  state: ActionState;
  sessionId: string;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
}): Promise<void> {
  const { error, promptHistory, model, state, sessionId, sessionService, refreshSessions } = args;
  const message = error instanceof Error ? error.message : String(error);
  const formattedMessage = formatChatFailureMessage(message, {
    model,
    estimatedHistoryTokens: estimateChatHistoryTokens(promptHistory),
  });
  state.setError(formattedMessage);
  state.setStatus('Error');
  sessionService.appendMessage(sessionId, {
    id: state.nextLocalId(),
    role: 'assistant',
    text: `Run failed before a final answer: ${formattedMessage}`,
  });
  refreshSessions();
}
