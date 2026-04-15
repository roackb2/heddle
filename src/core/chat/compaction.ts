import type { ChatMessage, LlmUsage } from '../../index.js';
import { buildSystemPrompt } from '../../prompts/system-prompt.js';
import { estimateBuiltInContextWindow } from '../../llm/openai-models.js';
import type { ChatContextStats } from './types.js';

const DEFAULT_CONTEXT_WINDOW_ESTIMATE = 200_000;
const MAX_HISTORY_RATIO = 0.6;
const MIN_RECENT_MESSAGES = 16;
const MIN_FORCED_RECENT_MESSAGES = 3;
const MAX_SUMMARY_LINES = 12;
const MAX_SUMMARY_CHARS = 4_000;
const COMPACTED_HISTORY_MARKER = 'Heddle compacted earlier conversation history.';

export function compactChatHistory(options: {
  history: ChatMessage[];
  model: string;
  usage?: LlmUsage;
  force?: boolean;
  systemContext?: string;
  toolNames?: string[];
  goal?: string;
}): { history: ChatMessage[]; context: ChatContextStats } {
  const estimatedWindow = estimateBuiltInContextWindow(options.model) ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
  const maxHistoryTokens = Math.floor(estimatedWindow * MAX_HISTORY_RATIO);
  const minRecentMessages = options.force ? MIN_FORCED_RECENT_MESSAGES : MIN_RECENT_MESSAGES;
  let nextHistory = options.history;
  let compactedMessages = 0;

  while (
    (estimateChatHistoryTokens(nextHistory) > maxHistoryTokens || (options.force && compactedMessages === 0)) &&
    countNonCompactedMessages(nextHistory) > minRecentMessages
  ) {
    const splitIndex = findCompactionSplit(nextHistory, minRecentMessages);
    if (splitIndex <= 0 || splitIndex >= nextHistory.length) {
      break;
    }

    compactedMessages += countNonCompactedMessages(nextHistory.slice(0, splitIndex));
    nextHistory = buildCompactedHistory(nextHistory, splitIndex);
  }

  return {
    history: nextHistory,
    context: buildContextStats({
      history: nextHistory,
      usage: options.usage,
      compactedMessages,
      estimatedRequestTokens: estimateRequestTokens({
        history: nextHistory,
        systemContext: options.systemContext,
        toolNames: options.toolNames ?? [],
        goal: options.goal,
      }),
    }),
  };
}

export function estimateChatHistoryTokens(history: ChatMessage[]): number {
  return history.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function isCompactedHistorySummary(message: ChatMessage): boolean {
  return message.role === 'system' && message.content.startsWith(COMPACTED_HISTORY_MARKER);
}

function buildContextStats(options: {
  history: ChatMessage[];
  usage?: LlmUsage;
  compactedMessages: number;
  estimatedRequestTokens?: number;
}): ChatContextStats {
  return {
    estimatedHistoryTokens: estimateChatHistoryTokens(options.history),
    estimatedRequestTokens: options.estimatedRequestTokens,
    lastRunInputTokens: options.usage?.inputTokens,
    lastRunOutputTokens: options.usage?.outputTokens,
    lastRunTotalTokens: options.usage?.totalTokens,
    cachedInputTokens: options.usage?.cachedInputTokens,
    reasoningTokens: options.usage?.reasoningTokens,
    compactedMessages: options.compactedMessages > 0 ? options.compactedMessages : undefined,
    compactedAt: options.compactedMessages > 0 ? new Date().toISOString() : undefined,
  };
}

function buildCompactedHistory(history: ChatMessage[], splitIndex: number): ChatMessage[] {
  const archived = history.slice(0, splitIndex);
  const recent = history.slice(splitIndex);
  const priorSummary = extractPriorSummary(archived);
  const visibleLines = archived
    .filter((message) => !isCompactedHistorySummary(message))
    .flatMap(summarizeMessageForCompaction)
    .slice(-MAX_SUMMARY_LINES);

  const summaryParts = [COMPACTED_HISTORY_MARKER];
  if (priorSummary) {
    summaryParts.push('', 'Earlier compacted summary:', priorSummary);
  }
  if (visibleLines.length > 0) {
    summaryParts.push('', 'More recent archived turns:', ...visibleLines);
  }

  const compactedSummary: ChatMessage = {
    role: 'system',
    content: truncateSummary(summaryParts.join('\n')),
  };
  return [compactedSummary, ...recent];
}

function extractPriorSummary(history: ChatMessage[]): string | undefined {
  const summaryMessage = history.find(isCompactedHistorySummary);
  if (!summaryMessage || summaryMessage.role !== 'system') {
    return undefined;
  }

  return summaryMessage.content.slice(COMPACTED_HISTORY_MARKER.length).trim() || undefined;
}

function summarizeMessageForCompaction(message: ChatMessage): string[] {
  if (message.role === 'user') {
    return [`User: ${truncateLine(message.content, 220)}`];
  }

  if (message.role === 'assistant') {
    const lines = [`Assistant: ${truncateLine(message.content, 220)}`];
    if (message.toolCalls?.length) {
      lines.push(`Assistant tool calls: ${message.toolCalls.map((call) => call.tool).join(', ')}`);
    }
    return lines;
  }

  if (message.role === 'tool') {
    return [`Tool result recorded for ${message.toolCallId}.`];
  }

  return [];
}

function truncateSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}

function truncateLine(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function countNonCompactedMessages(history: ChatMessage[]): number {
  return history.filter((message) => !isCompactedHistorySummary(message)).length;
}

function findCompactionSplit(history: ChatMessage[], minRecentMessages: number): number {
  let splitIndex = Math.max(0, history.length - minRecentMessages);

  while (splitIndex < history.length && history[splitIndex]?.role === 'tool') {
    splitIndex++;
  }

  while (
    splitIndex < history.length &&
    splitIndex > 0 &&
    isAssistantToolCallMessage(history[splitIndex - 1])
  ) {
    splitIndex++;
    while (splitIndex < history.length && history[splitIndex]?.role === 'tool') {
      splitIndex++;
    }
  }

  return splitIndex;
}

function estimateMessageTokens(message: ChatMessage): number {
  if (isCompactedHistorySummary(message)) {
    return estimateTextTokens(message.content) + 12;
  }

  switch (message.role) {
    case 'system':
    case 'user':
    case 'tool':
      return estimateTextTokens(message.content) + 12;
    case 'assistant':
      return estimateTextTokens(message.content) + 12 + (message.toolCalls?.length ?? 0) * 24;
  }
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateRequestTokens(options: {
  history: ChatMessage[];
  systemContext?: string;
  toolNames: string[];
  goal?: string;
}): number {
  const syntheticGoal = options.goal ?? 'Continue from the current conversation.';
  const systemPrompt = buildSystemPrompt(syntheticGoal, options.toolNames, options.systemContext);
  const userPrompt = syntheticGoal;
  return estimateTextTokens(systemPrompt) + estimateChatHistoryTokens(options.history) + estimateTextTokens(userPrompt) + 24;
}

function isAssistantToolCallMessage(
  message: ChatMessage | undefined,
): message is Extract<ChatMessage, { role: 'assistant'; toolCalls?: unknown }> & { toolCalls: NonNullable<Extract<ChatMessage, { role: 'assistant' }>['toolCalls']> } {
  return message?.role === 'assistant' && !!message.toolCalls && message.toolCalls.length > 0;
}
