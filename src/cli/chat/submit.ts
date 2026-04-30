import { runLocalCommand } from './state/local-commands.js';
import { buildCompactionRunningContext, compactChatHistoryWithArchive } from './state/compaction.js';
import { createInitialMessages } from './state/storage.js';
import type { ChatSession, ConversationLine } from './state/types.js';
import { buildConversationMessages, normalizeInlineText } from './utils/format.js';
import type { ProviderCredentialSource } from './utils/runtime.js';

type SessionUpdater = (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;

type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

type LocalCommandDeps = Parameters<typeof runLocalCommand>[0];

type SubmitChatPromptArgs = {
  value: string;
  isRunning: boolean;
  activeModel: string;
  setActiveModel: (model: string) => void;
  sessions: ChatSession[];
  recentSessions: ChatSession[];
  activeSessionId: string;
  activeSession?: ChatSession;
  apiKeyPresent: boolean;
  nextLocalId: () => string;
  setStatus: (value: string) => void;
  switchSession: (id: string) => void;
  closeSession: (id: string) => void;
  updateSessionById: SessionUpdater;
  updateActiveSession: ActiveSessionUpdater;
  createSession: (name?: string) => ChatSession;
  renameSession: (name: string) => void;
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
    setActiveModel: args.setActiveModel,
    sessions: args.sessions,
    recentSessions: args.recentSessions,
    activeSessionId: args.activeSessionId,
    switchSession: args.switchSession,
    createSession: args.createSession,
    renameSession: args.renameSession,
    removeSession: args.closeSession,
    clearConversation: () => {
      args.updateActiveSession((session) => ({
        ...session,
        history: [],
        turns: [],
        lastContinuePrompt: undefined,
        messages: createInitialMessages(args.apiKeyPresent),
      }));
    },
    compactConversation: () => {
      const session = args.activeSession ?? args.sessions.find((candidate) => candidate.id === args.activeSessionId);
      if (!session) {
        return 'No active session is available to compact.';
      }

      args.setStatus('Compacting');
      args.updateActiveSession((currentSession) => ({
        ...currentSession,
        context: buildCompactionRunningContext({
          history: currentSession.history,
          previous: currentSession.context,
          archiveCount: currentSession.archives?.length,
          currentSummaryPath: currentSession.context?.currentSummaryPath,
        }),
      }));

      return compactChatHistoryWithArchive({
        history: session.history,
        model: args.activeModel,
        sessionId: session.id,
        stateRoot: args.stateRoot,
        force: true,
        summarizer: { credentialSource: args.providerCredentialSource },
      }).then((compacted) => {
        const changed =
          compacted.history.length !== session.history.length
          || compacted.context.compactedMessages !== undefined
          || compacted.archives.length !== (session.archives?.length ?? 0);

        if (!changed) {
          args.setStatus('Idle');
          return 'Current session history is already compact enough.';
        }

        args.updateActiveSession((currentSession) => ({
          ...currentSession,
          history: compacted.history,
          context: compacted.context,
          archives: compacted.archives,
          messages: buildConversationMessages(compacted.history),
        }));
        args.setStatus('Idle');

        return compacted.context.compactedMessages && compacted.context.lastArchivePath ?
            `Compacted earlier session history into a rolling summary and archived ${compacted.context.compactedMessages} messages.\nArchive: ${compacted.context.lastArchivePath}`
          : compacted.context.compactionError ?
            `Compaction skipped. ${compacted.context.compactionError}`
          : 'Current session history is already compact enough.';
      }).catch((error) => {
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
  } satisfies LocalCommandDeps);

  if (!commandResult.handled) {
    const prepared = args.preparePrompt ? args.preparePrompt(prompt) : { prompt, displayText: prompt };
    await args.executeTurn(prepared.prompt, prepared.displayText ?? prompt);
    return;
  }

  if (commandResult.kind === 'message') {
    if (commandResult.sessionId) {
      appendAssistantMessageToSession(args.updateSessionById, commandResult.sessionId, args.nextLocalId, commandResult.message);
    } else {
      appendAssistantMessage(args.updateActiveSession, args.nextLocalId, commandResult.message);
    }
    args.setStatus('Idle');
    return;
  }

  if (commandResult.kind === 'execute') {
    if (commandResult.message) {
      appendAssistantMessage(args.updateActiveSession, args.nextLocalId, commandResult.message);
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
    args.updateSessionById(targetId, (session) => ({
      ...session,
      messages: [...session.messages, createAssistantMessage(args.nextLocalId, continueMessage)],
    }));
  }

  if (!targetHistory.length || !targetContinuePrompt) {
    args.updateSessionById(targetId, (session) => ({
      ...session,
      messages: [
        ...session.messages,
        createAssistantMessage(args.nextLocalId, 'There is no interrupted or prior run to continue yet.'),
      ],
    }));
    args.setStatus('Idle');
    return;
  }

  if (!continueMessage) {
    args.updateSessionById(targetId, (session) => ({
      ...session,
      messages: [...session.messages, createAssistantMessage(args.nextLocalId, 'Continuing from the current transcript.')],
    }));
  }

  await args.executeTurn('Continue from where you left off.', 'Continue', targetId);
}

function appendAssistantMessage(
  updateSession: ActiveSessionUpdater,
  nextLocalId: () => string,
  text: string,
) {
  updateSession((session) => ({
    ...session,
    messages: [...session.messages, createAssistantMessage(nextLocalId, text)],
  }));
}

function appendAssistantMessageToSession(
  updateSessionById: SessionUpdater,
  sessionId: string,
  nextLocalId: () => string,
  text: string,
) {
  updateSessionById(sessionId, (session) => ({
    ...session,
    messages: [...session.messages, createAssistantMessage(nextLocalId, text)],
  }));
}

function createAssistantMessage(nextLocalId: () => string, text: string): ConversationLine {
  return {
    id: nextLocalId(),
    role: 'assistant',
    text,
  };
}
