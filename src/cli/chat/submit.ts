import { runLocalCommand } from './state/local-commands.js';
import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import type { RouterInputs } from '@/client-shared/api/types.js';
import type { ConversationSessionService } from '../../core/chat/engine/types.js';
import type { ReasoningEffort } from '../../core/llm/types.js';
import type { ChatSession, ConversationLine } from './state/types.js';
import { normalizeInlineText } from './utils/format.js';
import type { ProviderCredentialSource } from './utils/runtime.js';

type LocalCommandDeps = Parameters<typeof runLocalCommand>[0];

type SubmitChatPromptArgs = {
  value: string;
  isRunning: boolean;
  activeModel: string;
  activeReasoningEffort?: ReasoningEffort;
  setActiveModel: (model: string) => void;
  setActiveReasoningEffort: (effort: ReasoningEffort | undefined) => void;
  sessions: ChatSession[];
  recentSessions: ChatSession[];
  activeSessionId: string;
  activeSession?: ChatSession;
  apiKeyPresent: boolean;
  nextLocalId: () => string;
  setStatus: (value: string) => void;
  switchSession: (id: string) => void;
  closeSession: (id: string) => Promise<void> | void;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
  resetSession: (id: string) => Promise<void>;
  controlPlaneClient: ControlPlaneProxyClient;
  workspaceId?: string;
  createSession: (name?: string) => Promise<ChatSession> | ChatSession;
  renameSession: (name: string) => Promise<void> | void;
  listRecentSessionsMessage: string[];
  driftEnabled: boolean;
  driftError?: string;
  setDriftEnabled: (enabled: boolean) => void;
  workspaceRoot: string;
  stateRoot: string;
  credentialStorePath?: string;
  providerCredentialSource?: ProviderCredentialSource;
  preparePrompt?: (prompt: string) => { prompt: string; displayText?: string };
  executeTurn: (prompt: string, displayText?: string, sessionIdOverride?: string) => Promise<void>;
  executeDirectShellCommand: (rawCommand: string) => Promise<void>;
  saveTuiSnapshot?: () => Promise<string> | string;
};

export async function submitChatPrompt(args: SubmitChatPromptArgs): Promise<void> {
  const prompt = normalizeInlineText(args.value);
  if (!prompt || args.isRunning) {
    return;
  }

  if (prompt.startsWith('!')) {
    await args.executeDirectShellCommand(prompt.slice(1).trim());
    return;
  }

  const commandResult = await runLocalCommand({
    prompt,
    activeModel: args.activeModel,
    activeReasoningEffort: args.activeReasoningEffort,
    setActiveModel: args.setActiveModel,
    setActiveReasoningEffort: args.setActiveReasoningEffort,
    sessions: args.sessions,
    recentSessions: args.recentSessions,
    activeSessionId: args.activeSessionId,
    switchSession: args.switchSession,
    createSession: args.createSession,
    renameSession: args.renameSession,
    removeSession: args.closeSession,
    clearConversation: async () => await args.resetSession(args.activeSessionId),
    compactConversation: () => {
      const session = args.activeSession ?? args.sessions.find((candidate) => candidate.id === args.activeSessionId);
      if (!session) {
        return 'No active session is available to compact.';
      }

      args.setStatus('Compacting');
      return args.controlPlaneClient.controlPlane.sessionCompact.mutate({
        id: session.id,
        workspaceId: args.workspaceId,
        force: true,
      } satisfies RouterInputs['controlPlane']['sessionCompact']).then((compacted) => {
        args.refreshSessions();
        args.setStatus('Idle');
        return compacted.context?.compaction?.compactedMessages && compacted.context.archive?.lastArchivePath ?
            `Compacted earlier session history into a rolling summary and archived ${compacted.context.compaction.compactedMessages} messages.\nArchive: ${compacted.context.archive.lastArchivePath}`
          : compacted.context?.compaction?.error ?
            `Compaction skipped. ${compacted.context.compaction.error}`
          : 'Current session history is already compact enough.';
      }).catch((error: unknown) => {
        args.refreshSessions();
        args.setStatus('Idle');
        return error instanceof Error ? `Compaction failed. ${error.message}` : `Compaction failed. ${String(error)}`;
      });
    },
    saveTuiSnapshot: args.saveTuiSnapshot,
    driftEnabled: args.driftEnabled,
    driftError: args.driftError,
    setDriftEnabled: args.setDriftEnabled,
    listRecentSessionsMessage: args.listRecentSessionsMessage,
    workspaceRoot: args.workspaceRoot,
    stateRoot: args.stateRoot,
    credentialStorePath: args.credentialStorePath,
    providerCredentialSource: args.providerCredentialSource,
  } satisfies LocalCommandDeps);

  if (!commandResult.handled) {
    const prepared = args.preparePrompt ? args.preparePrompt(prompt) : { prompt, displayText: prompt };
    await args.executeTurn(prepared.prompt, prepared.displayText ?? prompt);
    return;
  }

  if (commandResult.kind === 'message') {
    if (commandResult.sessionId) {
      appendAssistantMessage(args, commandResult.sessionId, commandResult.message);
    } else {
      appendAssistantMessage(args, args.activeSessionId, commandResult.message);
    }
    args.setStatus('Idle');
    return;
  }

  if (commandResult.kind === 'execute') {
    if (commandResult.message) {
      appendAssistantMessage(args, args.activeSessionId, commandResult.message);
    }
    await args.executeTurn(commandResult.prompt, commandResult.displayText);
    return;
  }

  if (commandResult.sessionId) {
    args.switchSession(commandResult.sessionId);
  }

  const targetId = commandResult.sessionId ?? args.activeSessionId;
  const targetSession = args.sessions.find((session) => session.id === targetId) ?? args.activeSession;
  const targetHistory = targetSession?.history ?? [];
  const targetContinuePrompt = targetSession?.lastContinuePrompt;
  const continueMessage = commandResult.message;

  if (continueMessage) {
    appendAssistantMessage(args, targetId, continueMessage);
  }

  if (!targetHistory.length || !targetContinuePrompt) {
    appendAssistantMessage(args, targetId, 'There is no interrupted or prior run to continue yet.');
    args.setStatus('Idle');
    return;
  }

  if (!continueMessage) {
    appendAssistantMessage(args, targetId, 'Continuing from the current transcript.');
  }

  await args.executeTurn('Continue from where you left off.', 'Continue', targetId);
}

function appendAssistantMessage(
  args: Pick<SubmitChatPromptArgs, 'sessionService' | 'refreshSessions' | 'nextLocalId'>,
  sessionId: string,
  text: string,
) {
  args.sessionService.appendMessage(sessionId, createAssistantMessage(args.nextLocalId, text));
  args.refreshSessions();
}

function createAssistantMessage(nextLocalId: () => string, text: string): ConversationLine {
  return {
    id: nextLocalId(),
    role: 'assistant',
    text,
  };
}
