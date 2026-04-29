import type { ChatMessage, LlmAdapter, LlmUsage } from '../../index.js';
import { createLlmAdapter, inferProviderFromModel } from '../../index.js';
import { hasProviderCredentialForModel, resolveApiKeyForModel } from '../runtime/api-keys.js';
import { estimateBuiltInContextWindow } from '../llm/openai-models.js';
import type { ChatArchiveManifest, ChatArchiveRecord, ChatContextStats } from './types.js';
import {
  createArchiveId,
  deriveChatArchivePaths,
  loadChatArchiveManifest,
  readArchiveSummaryMarkdown,
  saveChatArchiveManifest,
  updateChatArchiveManifest,
  writeArchivedMessagesJsonl,
  writeArchiveSummaryMarkdown,
} from './archive.js';

const DEFAULT_CONTEXT_WINDOW_ESTIMATE = 200_000;
const MAX_HISTORY_RATIO = 0.6;
const MIN_RECENT_MESSAGES = 16;
const MIN_FORCED_RECENT_MESSAGES = 3;
const MAX_ROLLING_SUMMARY_CHARS = 12_000;
const MAX_SUMMARIZER_TRANSCRIPT_CHARS = 240_000;
const MAX_SUMMARIZER_MESSAGE_CHARS = 4_000;
const MIN_SUMMARIZER_MESSAGE_CHARS = 240;
const COMPACTED_HISTORY_MARKER = 'Heddle compacted earlier conversation history.';
const DEFAULT_OPENAI_COMPACTION_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_ANTHROPIC_COMPACTION_MODEL = 'claude-haiku-4-5';

export type CompactionSummarizerOptions = {
  provider?: 'openai' | 'anthropic' | 'active';
  model?: string;
  apiKey?: string;
  llm?: LlmAdapter;
};

export type CompactChatHistoryWithArchiveOptions = {
  history: ChatMessage[];
  model: string;
  sessionId: string;
  stateRoot: string;
  usage?: LlmUsage;
  force?: boolean;
  systemContext?: string;
  toolNames?: string[];
  goal?: string;
  summarizer?: CompactionSummarizerOptions;
  onStatusChange?: (event: { status: 'running' | 'finished' | 'failed'; archivePath?: string; summaryPath?: string; error?: string }) => void;
};

export type CompactChatHistoryResult = {
  history: ChatMessage[];
  context: ChatContextStats;
  archives: ChatArchiveRecord[];
};

export async function compactChatHistoryWithArchive(
  options: CompactChatHistoryWithArchiveOptions,
): Promise<CompactChatHistoryResult> {
  const estimatedWindow = estimateBuiltInContextWindow(options.model) ?? DEFAULT_CONTEXT_WINDOW_ESTIMATE;
  const maxHistoryTokens = Math.floor(estimatedWindow * MAX_HISTORY_RATIO);
  const minRecentMessages = options.force ? MIN_FORCED_RECENT_MESSAGES : MIN_RECENT_MESSAGES;
  const needsCompaction =
    estimateChatHistoryTokens(options.history) > maxHistoryTokens
    || (Boolean(options.force) && countNonCompactedMessages(options.history) > 0);

  if (!needsCompaction) {
    const manifest = loadChatArchiveManifest(options.stateRoot, options.sessionId);
    return {
      history: options.history,
      context: buildContextStats({
        history: options.history,
        usage: options.usage,
        estimatedRequestTokens: estimateRequestTokens({
          history: options.history,
          systemContext: options.systemContext,
          toolNames: options.toolNames ?? [],
          goal: options.goal,
        }),
        archives: manifest.archives,
        currentSummaryPath: manifest.currentSummaryPath,
      }),
      archives: manifest.archives,
    };
  }

  const splitIndex = findCompactionSplit(options.history, minRecentMessages);
  if (splitIndex <= 0 || splitIndex >= options.history.length) {
    const manifest = loadChatArchiveManifest(options.stateRoot, options.sessionId);
    return {
      history: options.history,
      context: buildContextStats({
        history: options.history,
        usage: options.usage,
        estimatedRequestTokens: estimateRequestTokens({
          history: options.history,
          systemContext: options.systemContext,
          toolNames: options.toolNames ?? [],
          goal: options.goal,
        }),
        archives: manifest.archives,
        currentSummaryPath: manifest.currentSummaryPath,
      }),
      archives: manifest.archives,
    };
  }

  const archivedMessages = options.history.slice(0, splitIndex);
  const recentMessages = options.history.slice(splitIndex);
  const manifest = loadChatArchiveManifest(options.stateRoot, options.sessionId);
  const previousRollingSummary =
    (manifest.currentSummaryPath ? readArchiveSummaryMarkdown(manifest.currentSummaryPath, options.stateRoot) : undefined)
    ?? extractPriorSummary(options.history);

  const archiveId = createArchiveId();
  const archivePath = writeArchivedMessagesJsonl(options.stateRoot, options.sessionId, archiveId, archivedMessages);
  options.onStatusChange?.({ status: 'running', archivePath });

  try {
    const summarizer = resolveSummarizer(options);
    if (!summarizer.llm) {
      throw new Error(`Missing provider API key for ${summarizer.model}`);
    }

    const rollingSummary = await summarizeChatArchive({
      llm: summarizer.llm,
      summaryModel: summarizer.model,
      sessionId: options.sessionId,
      archivePath,
      manifest,
      previousRollingSummary,
      archivedMessages,
    });
    const summaryPath = writeArchiveSummaryMarkdown(options.stateRoot, options.sessionId, archiveId, rollingSummary);
    const archiveRecord: ChatArchiveRecord = {
      id: archiveId,
      path: archivePath,
      summaryPath,
      shortDescription: deriveShortDescription(rollingSummary),
      messageCount: countNonCompactedMessages(archivedMessages),
      createdAt: new Date().toISOString(),
      summaryModel: summarizer.model,
    };
    const nextManifest = updateChatArchiveManifest(manifest, archiveRecord);
    saveChatArchiveManifest(options.stateRoot, options.sessionId, nextManifest);

    const compactedHistory = [
      buildCompactedSummaryMessage({
        sessionId: options.sessionId,
        rollingSummary,
        archives: nextManifest.archives,
      }),
      ...recentMessages,
    ];

    options.onStatusChange?.({
      status: 'finished',
      archivePath: archiveRecord.path,
      summaryPath: archiveRecord.summaryPath,
    });

    return {
      history: compactedHistory,
      context: buildContextStats({
        history: compactedHistory,
        usage: options.usage,
        compactedMessages: archiveRecord.messageCount,
        estimatedRequestTokens: estimateRequestTokens({
          history: compactedHistory,
          systemContext: options.systemContext,
          toolNames: options.toolNames ?? [],
          goal: options.goal,
        }),
        compactedAt: archiveRecord.createdAt,
        archives: nextManifest.archives,
        currentSummaryPath: nextManifest.currentSummaryPath,
        lastArchivePath: archiveRecord.path,
      }),
      archives: nextManifest.archives,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onStatusChange?.({ status: 'failed', archivePath, error: message });
    return {
      history: options.history,
      context: buildContextStats({
        history: options.history,
        usage: options.usage,
        estimatedRequestTokens: estimateRequestTokens({
          history: options.history,
          systemContext: options.systemContext,
          toolNames: options.toolNames ?? [],
          goal: options.goal,
        }),
        compactionStatus: 'failed',
        compactionError: message,
        archives: manifest.archives,
        currentSummaryPath: manifest.currentSummaryPath,
        lastArchivePath: archivePath,
      }),
      archives: manifest.archives,
    };
  }
}

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
    nextHistory = buildLegacyCompactedHistory(nextHistory, splitIndex);
  }

  return {
    history: nextHistory,
    context: buildContextStats({
      history: nextHistory,
      usage: options.usage,
      compactedMessages,
      compactedAt: compactedMessages > 0 ? new Date().toISOString() : undefined,
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

export function buildCompactionRunningContext(options: {
  history: ChatMessage[];
  previous?: ChatContextStats;
  archiveCount?: number;
  currentSummaryPath?: string;
  lastArchivePath?: string;
}): ChatContextStats {
  return {
    ...options.previous,
    estimatedHistoryTokens: estimateChatHistoryTokens(options.history),
    compactionStatus: 'running',
    compactionError: undefined,
    archiveCount: options.archiveCount ?? options.previous?.archiveCount,
    currentSummaryPath: options.currentSummaryPath ?? options.previous?.currentSummaryPath,
    lastArchivePath: options.lastArchivePath ?? options.previous?.lastArchivePath,
  };
}

function buildContextStats(options: {
  history: ChatMessage[];
  usage?: LlmUsage;
  compactedMessages?: number;
  compactedAt?: string;
  estimatedRequestTokens?: number;
  compactionStatus?: ChatContextStats['compactionStatus'];
  compactionError?: string;
  archives?: ChatArchiveRecord[];
  currentSummaryPath?: string;
  lastArchivePath?: string;
}): ChatContextStats {
  return {
    estimatedHistoryTokens: estimateChatHistoryTokens(options.history),
    estimatedRequestTokens: options.estimatedRequestTokens,
    lastRunInputTokens: options.usage?.inputTokens,
    lastRunOutputTokens: options.usage?.outputTokens,
    lastRunTotalTokens: options.usage?.totalTokens,
    cachedInputTokens: options.usage?.cachedInputTokens,
    reasoningTokens: options.usage?.reasoningTokens,
    compactedMessages: options.compactedMessages && options.compactedMessages > 0 ? options.compactedMessages : undefined,
    compactedAt: options.compactedAt,
    compactionStatus: options.compactionStatus ?? 'idle',
    compactionError: options.compactionError,
    archiveCount: options.archives?.length || undefined,
    currentSummaryPath: options.currentSummaryPath,
    lastArchivePath: options.lastArchivePath,
  };
}

function buildLegacyCompactedHistory(history: ChatMessage[], splitIndex: number): ChatMessage[] {
  const archived = history.slice(0, splitIndex);
  const recent = history.slice(splitIndex);
  const priorSummary = extractPriorSummary(archived);
  const visibleLines = archived
    .filter((message) => !isCompactedHistorySummary(message))
    .flatMap(summarizeMessageForLegacyCompaction)
    .slice(-12);

  const summaryParts = [COMPACTED_HISTORY_MARKER];
  if (priorSummary) {
    summaryParts.push('', 'Earlier compacted summary:', priorSummary);
  }
  if (visibleLines.length > 0) {
    summaryParts.push('', 'More recent archived turns:', ...visibleLines);
  }

  return [{
    role: 'system',
    content: truncateSummary(summaryParts.join('\n')),
  }, ...recent];
}

function buildCompactedSummaryMessage(options: {
  sessionId: string;
  rollingSummary: string;
  archives: ChatArchiveRecord[];
}): ChatMessage {
  const archivePaths = options.archives
    .slice(-8)
    .map((archive) => `- ${archive.path}: ${archive.shortDescription ?? `${archive.messageCount} messages archived`}`);

  const content = [
    COMPACTED_HISTORY_MARKER,
    '',
    `Archive root: ${deriveChatArchivePaths('.', options.sessionId).displayArchivesDir}`,
    '',
    'Current rolling summary:',
    truncateSummary(options.rollingSummary),
    '',
    'Archive index:',
    ...(archivePaths.length > 0 ? archivePaths : ['- No archive records found.']),
    '',
    'If exact wording, tool output, or earlier rationale matters, inspect the archive files with normal file tools before relying on this summary.',
  ].join('\n');

  return {
    role: 'system',
    content,
  };
}

async function summarizeChatArchive(options: {
  llm: LlmAdapter;
  summaryModel: string;
  sessionId: string;
  archivePath: string;
  manifest: ChatArchiveManifest;
  previousRollingSummary?: string;
  archivedMessages: ChatMessage[];
}): Promise<string> {
  const archiveIndex = options.manifest.archives.map((archive) => ({
    id: archive.id,
    path: archive.path,
    summaryPath: archive.summaryPath,
    shortDescription: archive.shortDescription,
    messageCount: archive.messageCount,
    createdAt: archive.createdAt,
  }));

  const transcript = buildSummarizerTranscript(options.archivedMessages);

  const response = await options.llm.chat([
    {
      role: 'system',
      content: [
        'You summarize archived coding-agent conversations for later continuation.',
        'Produce markdown with moderate fidelity and no preamble.',
        'Preserve confirmed facts, user intent, concrete file/code references, decisions, commands, verification, risks, and follow-ups.',
        'Use these exact sections when relevant:',
        '# Compacted Conversation Rolling Summary',
        '## User Goals And Preferences',
        '## Work Completed',
        '## Important Decisions',
        '## Files And Code Areas Touched',
        '## Commands And Verification',
        '## Open Questions / Follow-Ups',
        '## Archive Index',
        '## High-Fidelity Details Worth Retrieving',
        'Integrate the previous rolling summary when present.',
        'Do not invent work that did not happen.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Session: ${options.sessionId}`,
        `New archive path: ${options.archivePath}`,
        '',
        'Previous rolling summary:',
        options.previousRollingSummary?.trim() || '(none)',
        '',
        'Existing archive index JSON:',
        JSON.stringify(archiveIndex, null, 2),
        '',
        'Newly archived transcript:',
        transcript,
        '',
        'Produce the next cumulative rolling summary for the active history. Keep it concise enough for model context, but detailed enough that another agent can reconstruct the work state.',
      ].join('\n'),
    },
  ], []);

  const content = response.content?.trim();
  if (!content) {
    throw new Error(`Compaction summarizer returned no content for ${options.summaryModel}`);
  }

  return content;
}

function resolveSummarizer(options: CompactChatHistoryWithArchiveOptions): { llm?: LlmAdapter; model: string } {
  if (options.summarizer?.llm) {
    return {
      llm: options.summarizer.llm,
      model: options.summarizer.llm.info?.model ?? options.summarizer.model ?? options.model,
    };
  }

  const provider =
    options.summarizer?.provider === 'active' || !options.summarizer?.provider ?
      inferProviderFromModel(options.model)
    : options.summarizer.provider;
  const model =
    options.summarizer?.model
    ?? (provider === 'anthropic' ?
      DEFAULT_ANTHROPIC_COMPACTION_MODEL
    : DEFAULT_OPENAI_COMPACTION_MODEL);
  const apiKey = options.summarizer?.apiKey ?? resolveApiKeyForModel(model);
  if (!hasProviderCredentialForModel(model, {
    apiKey,
    apiKeyProvider: options.summarizer?.apiKey ? 'explicit' : apiKey ? provider : undefined,
  })) {
    return { model };
  }

  return {
    model,
    llm: createLlmAdapter({ model, apiKey }),
  };
}

function extractPriorSummary(history: ChatMessage[]): string | undefined {
  const summaryMessage = history.find(isCompactedHistorySummary);
  if (!summaryMessage || summaryMessage.role !== 'system') {
    return undefined;
  }

  const content = summaryMessage.content.slice(COMPACTED_HISTORY_MARKER.length).trim();
  return content || undefined;
}

function summarizeMessageForLegacyCompaction(message: ChatMessage): string[] {
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

function renderArchivedMessage(message: ChatMessage): string {
  if (message.role === 'assistant') {
    return [
      'Role: assistant',
      message.content ? `Content:\n${message.content}` : 'Content: (empty)',
      message.toolCalls?.length ? `Tool calls:\n${JSON.stringify(message.toolCalls, null, 2)}` : undefined,
    ].filter((part): part is string => Boolean(part)).join('\n\n');
  }

  if (message.role === 'tool') {
    return [
      'Role: tool',
      `Tool call id: ${message.toolCallId}`,
      `Content:\n${message.content}`,
    ].join('\n\n');
  }

  return [
    `Role: ${message.role}`,
    `Content:\n${message.content}`,
  ].join('\n\n');
}

function buildSummarizerTranscript(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return '(no archived messages)';
  }

  const perMessageBudget = Math.max(
    MIN_SUMMARIZER_MESSAGE_CHARS,
    Math.min(MAX_SUMMARIZER_MESSAGE_CHARS, Math.floor(MAX_SUMMARIZER_TRANSCRIPT_CHARS / messages.length) - 80),
  );
  const lines: string[] = [
    `Summarizer transcript note: raw archive contains ${messages.length} complete messages.`,
    `Each message below is condensed to fit the summarizer request. Read the archive file when exact wording or full tool output matters.`,
  ];
  let totalChars = lines.join('\n').length;

  for (const [index, message] of messages.entries()) {
    const rendered = `## Message ${index + 1}\n${renderArchivedMessageForSummary(message, perMessageBudget)}`;
    const separator = lines.length > 0 ? '\n\n' : '';
    if (totalChars + separator.length + rendered.length > MAX_SUMMARIZER_TRANSCRIPT_CHARS) {
      lines.push(`\n\nOmitted ${messages.length - index} additional archived messages from summarizer input to stay within request budget. Inspect the raw archive for full detail.`);
      break;
    }

    lines.push(rendered);
    totalChars += separator.length + rendered.length;
  }

  return lines.join('\n\n');
}

function renderArchivedMessageForSummary(message: ChatMessage, maxChars: number): string {
  if (message.role === 'assistant') {
    const parts = [
      'Role: assistant',
      message.content ? `Content excerpt:\n${truncateForSummary(message.content, maxChars)}` : 'Content: (empty)',
      message.toolCalls?.length ?
        `Tool calls:\n${truncateForSummary(JSON.stringify(message.toolCalls, null, 2), maxChars)}`
      : undefined,
    ].filter((part): part is string => Boolean(part));
    return parts.join('\n\n');
  }

  if (message.role === 'tool') {
    return [
      'Role: tool',
      `Tool call id: ${message.toolCallId}`,
      `Content excerpt:\n${truncateForSummary(message.content, maxChars)}`,
    ].join('\n\n');
  }

  return [
    `Role: ${message.role}`,
    `Content excerpt:\n${truncateForSummary(message.content, maxChars)}`,
  ].join('\n\n');
}

function deriveShortDescription(summary: string): string | undefined {
  const lines = summary
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const first = lines[0];
  return first ? truncateLine(first, 120) : undefined;
}

function truncateSummary(value: string): string {
  if (value.length <= MAX_ROLLING_SUMMARY_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_ROLLING_SUMMARY_CHARS - 1).trimEnd()}…`;
}

function truncateForSummary(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[truncated ${value.length - maxChars} chars; full content is in the raw archive]`;
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
  const systemPromptEstimate = estimateTextTokens([
    syntheticGoal,
    options.systemContext ?? '',
    options.toolNames.join(','),
  ].join('\n'));
  return systemPromptEstimate + estimateChatHistoryTokens(options.history) + estimateTextTokens(syntheticGoal) + 24;
}

function isAssistantToolCallMessage(
  message: ChatMessage | undefined,
): message is Extract<ChatMessage, { role: 'assistant'; toolCalls?: unknown }> & { toolCalls: NonNullable<Extract<ChatMessage, { role: 'assistant' }>['toolCalls']> } {
  return message?.role === 'assistant' && !!message.toolCalls && message.toolCalls.length > 0;
}
