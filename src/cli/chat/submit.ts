import { runLocalCommand } from './state/local-commands.js';
import { createInitialMessages } from './state/storage.js';
import type { ChatSession, ConversationLine } from './state/types.js';
import { normalizeInlineText } from './utils/format.js';

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
  preparePrompt?: (prompt: string) => { prompt: string; displayText?: string };
  executeTurn: (prompt: string, displayText?: string, sessionIdOverride?: string) => Promise<void>;
  executeDirectShellCommand: (rawCommand: string) => Promise<void>;
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

  const commandResult = runLocalCommand({
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
    listRecentSessionsMessage: args.listRecentSessionsMessage,
  } satisfies LocalCommandDeps);

  if (!commandResult.handled) {
    const prepared = args.preparePrompt ? args.preparePrompt(prompt) : { prompt, displayText: prompt };
    await args.executeTurn(prepared.prompt, prepared.displayText ?? prompt);
    return;
  }

  if (commandResult.kind === 'message') {
    appendAssistantMessage(args.updateActiveSession, args.nextLocalId, commandResult.message);
    args.setStatus('Idle');
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

function createAssistantMessage(nextLocalId: () => string, text: string): ConversationLine {
  return {
    id: nextLocalId(),
    role: 'assistant',
    text,
  };
}
