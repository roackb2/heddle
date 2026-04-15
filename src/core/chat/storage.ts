import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChatMessage } from '../../index.js';
import type { ChatContextStats, ChatSession, ConversationLine, TurnSummary } from './types.js';
import { truncate } from '../../cli/chat/utils/format.js';

export function createInitialMessages(apiKeyPresent: boolean): ConversationLine[] {
  return [
    {
      id: 'intro',
      role: 'assistant',
      text:
        'Heddle conversational mode.\n\nAsk a question about this workspace.\nEach turn runs the current agent loop and carries the transcript into the next turn.\nUse !<command> to run a shell command directly in chat.',
    },
    ...(!apiKeyPresent ?
      [{
        id: 'missing-key',
        role: 'assistant' as const,
        text:
          'No provider API key detected. Set OPENAI_API_KEY for OpenAI models or ANTHROPIC_API_KEY for Claude models. Dev fallback conventions also work: PERSONAL_OPENAI_API_KEY and PERSONAL_ANTHROPIC_API_KEY.',
      }]
    : []),
  ];
}

export function createChatSession(options: {
  id: string;
  name: string;
  apiKeyPresent: boolean;
  model?: string;
}): ChatSession {
  const now = new Date().toISOString();
  return {
    id: options.id,
    name: options.name,
    history: [],
    messages: createInitialMessages(options.apiKeyPresent),
    turns: [],
    createdAt: now,
    updatedAt: now,
    model: options.model,
    driftEnabled: true,
    lastContinuePrompt: undefined,
    context: undefined,
  };
}

export function touchSession(session: ChatSession): ChatSession {
  return { ...session, updatedAt: new Date().toISOString() };
}

export function summarizeSession(session: ChatSession): string {
  const latestTurn = session.turns[session.turns.length - 1];
  const latestPrompt = latestTurn ? truncate(latestTurn.prompt, 44) : 'no turns yet';
  return `${session.turns.length} turns • ${latestPrompt}`;
}

export function isGenericSessionName(name: string): boolean {
  return /^Session \d+$/.test(name.trim());
}

export function loadChatSessions(sessionsPath: string, apiKeyPresent: boolean): ChatSession[] {
  try {
    if (!existsSync(sessionsPath)) {
      return [
        createChatSession({
          id: 'session-1',
          name: 'Session 1',
          apiKeyPresent,
        }),
      ];
    }

    const raw = readFileSync(sessionsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Expected session array');
    }

    const sessions = parsed.flatMap((value) => parseSavedSession(value, apiKeyPresent));
    if (sessions.length > 0) {
      return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
  } catch (error) {
    process.stderr.write(
      `Failed to load chat sessions from ${sessionsPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return [
    createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent,
    }),
  ];
}

export function saveChatSessions(sessionsPath: string, sessions: ChatSession[]) {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function parseSavedSession(value: unknown, apiKeyPresent: boolean): ChatSession[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<ChatSession>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return [];
  }

  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

  return [{
    id: candidate.id,
    name: candidate.name,
    history: Array.isArray(candidate.history) ? candidate.history as ChatMessage[] : [],
    messages:
      Array.isArray(candidate.messages) && candidate.messages.length > 0 ?
        candidate.messages.filter(isConversationLine)
      : createInitialMessages(apiKeyPresent),
    turns: Array.isArray(candidate.turns) ? candidate.turns.filter(isTurnSummary) : [],
    createdAt,
    updatedAt,
    model: typeof candidate.model === 'string' ? candidate.model : undefined,
    driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : true,
    lastContinuePrompt: typeof candidate.lastContinuePrompt === 'string' ? candidate.lastContinuePrompt : undefined,
    context: isChatContextStats(candidate.context) ? candidate.context : undefined,
  }];
}

function isConversationLine(value: unknown): value is ConversationLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ConversationLine>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.text === 'string'
  );
}

function isTurnSummary(value: unknown): value is TurnSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<TurnSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.outcome === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.steps === 'number' &&
    typeof candidate.traceFile === 'string' &&
    Array.isArray(candidate.events) &&
    candidate.events.every((event) => typeof event === 'string')
  );
}

function isChatContextStats(value: unknown): value is ChatContextStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ChatContextStats>;
  return (
    typeof candidate.estimatedHistoryTokens === 'number' &&
    (candidate.estimatedRequestTokens === undefined || typeof candidate.estimatedRequestTokens === 'number') &&
    (candidate.lastRunInputTokens === undefined || typeof candidate.lastRunInputTokens === 'number') &&
    (candidate.lastRunOutputTokens === undefined || typeof candidate.lastRunOutputTokens === 'number') &&
    (candidate.lastRunTotalTokens === undefined || typeof candidate.lastRunTotalTokens === 'number') &&
    (candidate.cachedInputTokens === undefined || typeof candidate.cachedInputTokens === 'number') &&
    (candidate.reasoningTokens === undefined || typeof candidate.reasoningTokens === 'number') &&
    (candidate.compactedMessages === undefined || typeof candidate.compactedMessages === 'number') &&
    (candidate.compactedAt === undefined || typeof candidate.compactedAt === 'string')
  );
}
