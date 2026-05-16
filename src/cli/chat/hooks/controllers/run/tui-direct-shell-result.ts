import { summarizeToolCall } from '../../../../../core/observability/conversation-activity.js';
import type { ConversationSessionService } from '../../../../../core/chat/engine/types.js';
import { appendDirectShellHistory, formatDirectShellResponse } from '../../../utils/format.js';
import { ConversationCompactionService } from '../../../state/compaction.js';
import type { ChatSession } from '../../../state/types.js';
import type { ChatRuntimeConfig } from '../../../utils/runtime.js';
import type { ActionState } from '../useAgentRunController.js';
import { createTuiDirectShellCompactionStatusHandler } from './tui-compaction-status.js';

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
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
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
    sessionService,
    refreshSessions,
    maybeAutoNameSession,
  } = args;

  const responseText = formatDirectShellResponse(chosenCall.tool, command, chosenResult);
  const directShellHistory = appendDirectShellHistory(activeSession.history, shellDisplay, chosenCall.tool, chosenResult);
  const emitCompactionStatus = createTuiDirectShellCompactionStatusHandler({
    state,
    sessionId: activeSessionId,
    sessionService,
    refreshSessions,
  });
  const compacted = await ConversationCompactionService.compact({
    history: directShellHistory,
    runtime: {
      model,
      stateRoot: runtime.stateRoot,
      systemContext: runtime.systemContext,
    },
    session: activeSession,
    request: {
      toolNames: tools.map((tool) => tool.name),
      goal: shellDisplay,
    },
    summarizer: { credentialSource: runtime.providerCredentialSource },
    onStatusChange: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; error?: string }) => emitCompactionStatus(event, directShellHistory),
  });
  sessionService.applyCompactionResult(activeSessionId, compacted);
  refreshSessions();
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
