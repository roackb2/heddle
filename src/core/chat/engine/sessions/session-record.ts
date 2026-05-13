/**
 * Session record domain helpers.
 *
 * Owns in-memory session record behavior that should not know about file
 * storage: default messages, record creation, touched timestamps, and
 * lightweight naming/summary helpers.
 *
 * File I/O belongs in the session repository. Hosts should consume services,
 * not call these helpers as a substitute for storage behavior.
 */
import { truncate } from '../../../utils/text.js';
import type { ReasoningEffort } from '../../../llm/types.js';
import type { ChatSession, ConversationLine } from '../../types.js';

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
          'No provider credential detected. For OpenAI, run `heddle auth login openai` or set OPENAI_API_KEY. For Anthropic, set ANTHROPIC_API_KEY. Dev fallback conventions also work: PERSONAL_OPENAI_API_KEY and PERSONAL_ANTHROPIC_API_KEY.',
      }]
    : []),
  ];
}

export function createChatSession(options: {
  id: string;
  name: string;
  apiKeyPresent: boolean;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  workspaceId?: string;
}): ChatSession {
  const now = new Date().toISOString();
  return {
    id: options.id,
    name: options.name,
    workspaceId: options.workspaceId,
    history: [],
    messages: createInitialMessages(options.apiKeyPresent),
    turns: [],
    createdAt: now,
    updatedAt: now,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    driftEnabled: false,
    lastContinuePrompt: undefined,
    context: undefined,
    archives: [],
    lease: undefined,
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
