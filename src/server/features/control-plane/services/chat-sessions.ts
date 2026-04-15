import { existsSync, readFileSync } from 'node:fs';
import type { ChatSessionView } from '../types.js';

export function readChatSessionViews(sessionsPath: string): ChatSessionView[] {
  if (!existsSync(sessionsPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(sessionsPath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap(projectChatSessionView).sort((left, right) => {
      return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
    });
  } catch {
    return [];
  }
}

export function projectChatSessionView(raw: unknown): ChatSessionView[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id : undefined;
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  if (!id || !name) {
    return [];
  }

  const turns = Array.isArray(candidate.turns) ? candidate.turns : [];
  const messages = Array.isArray(candidate.messages) ? candidate.messages : [];
  const lastTurn = readObject(turns.at(-1));
  const context = readObject(candidate.context);

  return [{
    id,
    name,
    createdAt: readString(candidate.createdAt),
    updatedAt: readString(candidate.updatedAt),
    model: readString(candidate.model),
    driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : undefined,
    messageCount: messages.length,
    turnCount: turns.length,
    lastPrompt: readString(lastTurn?.prompt),
    lastOutcome: readString(lastTurn?.outcome),
    lastSummary: readString(lastTurn?.summary),
    context: context ? {
      estimatedHistoryTokens: readNumber(context.estimatedHistoryTokens),
      estimatedRequestTokens: readNumber(context.estimatedRequestTokens),
      lastRunInputTokens: readNumber(context.lastRunInputTokens),
      lastRunOutputTokens: readNumber(context.lastRunOutputTokens),
      lastRunTotalTokens: readNumber(context.lastRunTotalTokens),
    } : undefined,
  }];
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
