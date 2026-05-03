import { summarizeToolCall } from '../../../core/observability/conversation-activity.js';
import { appendDirectShellHistory, buildConversationMessages, formatDirectShellResponse } from '../utils/format.js';
import { compactChatHistoryWithArchive } from '../state/compaction.js';
import type { ChatSession } from '../state/types.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import type { ActionState } from './useAgentRun.js';
import { createTuiDirectShellCompactionStatusHandler } from './tui-compaction-status.js';

type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

export async function finalizeTuiDirectShellSuccess(args: {
  chosenCall: { tool: string; input: unknown };
  chosenResult: { ok: boolean; error?: string };
  command: string;
  shellDisplay: string;
  model: string;
  activeSessionId: string;
  activeSession: ChatSession;
  runtime: ChatRuntimeConfig;
  tools: Array<{ name: string }>;
  state: ActionState;
  updateActiveSession: ActiveSessionUpdater;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
}) {
  const {
    chosenCall,
    chosenResult,
    command,
    shellDisplay,
    model,
    activeSessionId,
    activeSession,
    runtime,
    tools,
    state,
    updateActiveSession,
    maybeAutoNameSession,
  } = args;

  const responseText = formatDirectShellResponse(chosenCall.tool, command, chosenResult);
  const directShellHistory = appendDirectShellHistory(activeSession.history, shellDisplay, chosenCall.tool, chosenResult);
  const emitCompactionStatus = createTuiDirectShellCompactionStatusHandler({ state, updateActiveSession });
  const compacted = await compactChatHistoryWithArchive({
    history: directShellHistory,
    model,
    sessionId: activeSessionId,
    stateRoot: runtime.stateRoot,
    systemContext: runtime.systemContext,
    toolNames: tools.map((tool) => tool.name),
    goal: shellDisplay,
    summarizer: { credentialSource: runtime.providerCredentialSource },
    onStatusChange: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; error?: string }) => emitCompactionStatus(event, directShellHistory),
  });
  updateActiveSession((session) => ({
    ...session,
    history: compacted.history,
    context: compacted.context,
    archives: compacted.archives,
    messages: buildConversationMessages(compacted.history),
  }));
  state.setLiveEvents([
    {
      id: state.nextLocalId(),
      text:
        chosenResult.ok ?
          `${summarizeToolCall(chosenCall.tool, chosenCall.input)} completed`
        : `${summarizeToolCall(chosenCall.tool, chosenCall.input)} failed`,
    },
  ]);
  state.setStatus(chosenResult.ok ? 'Idle' : 'Stopped: error');
  if (!chosenResult.ok && chosenResult.error) {
    state.setError(chosenResult.error);
  }
  maybeAutoNameSession(activeSessionId, shellDisplay, responseText);
}
