/**
 * Pure chat-session record domain behavior.
 *
 * This class has no storage or host dependencies. Keep reusable record
 * creation, timestamp, naming, and summary semantics here so the stateful
 * session service can compose them without growing scattered helper functions.
 */
import { truncate } from '@/core/utils/text.js';
import dayjs from 'dayjs';
import omit from 'lodash/omit.js';
import type { ChatSession, ConversationLine } from '@/core/chat/types.js';
import { TraceSummaryService } from '@/core/observability/index.js';
import { ConversationTurnPresentationService } from '@/core/chat/engine/turns/presentation/index.js';
import { ConversationLines } from './conversation-lines.js';
import type {
  ApplyCompactedChatSessionHistoryInput,
  ApplyCompletedChatSessionTurnInput,
  BuildChatTurnSummaryInput,
  ChatSessionResumeCandidate,
  CreateChatSessionRecordOptions,
  MarkAcceptedConversationUserMessageFailedInput,
  MarkAcceptedConversationUserMessageInput,
} from './types.js';

export class ChatSessionRecords {
  static create(options: CreateChatSessionRecordOptions): ChatSession {
    const now = new Date().toISOString();
    return {
      id: options.id,
      name: options.name,
      retention: options.retention ?? 'reusable',
      workspaceId: options.workspaceId,
      pinned: false,
      archivedAt: undefined,
      history: [],
      messages: [],
      turns: [],
      createdAt: now,
      updatedAt: now,
      lastUserActivityAt: undefined,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      driftEnabled: false,
      lastContinuePrompt: undefined,
      context: undefined,
      archives: [],
      leaseEpoch: 0,
      lease: undefined,
      queuedPrompts: [],
    };
  }

  static touch(session: ChatSession): ChatSession {
    return { ...session, updatedAt: new Date().toISOString() };
  }

  /**
   * Advances conversation recency without letting metadata or delayed work
   * rewrite the user's actual session order.
   */
  static markUserActivity(session: ChatSession, userActivityAt = new Date().toISOString()): ChatSession {
    const normalized = ChatSessionRecords.normalizeUserActivityAt(userActivityAt);
    const current = ChatSessionRecords.readTimestamp(session.lastUserActivityAt);
    if (current !== undefined && current >= dayjs(normalized).valueOf()) {
      return session;
    }

    return { ...session, lastUserActivityAt: normalized };
  }

  /** Pin state controls presentation only; resume selection follows user activity. */
  static resolveResumeCandidate<T extends ChatSessionResumeCandidate>(sessions: readonly T[]): T | undefined {
    const visible = sessions.filter((session) => !session.archivedAt);
    const withUserActivity = visible.filter((session) => (
      ChatSessionRecords.readTimestamp(session.lastUserActivityAt) !== undefined
    ));
    const candidates = withUserActivity.length > 0 ? withUserActivity : visible;
    const useUserActivity = withUserActivity.length > 0;

    return candidates.reduce<T | undefined>((latest, candidate) => {
      if (!latest) {
        return candidate;
      }

      const latestAt = ChatSessionRecords.readResumeTimestamp(latest, useUserActivity);
      const candidateAt = ChatSessionRecords.readResumeTimestamp(candidate, useUserActivity);
      if (candidateAt !== latestAt) {
        return candidateAt > latestAt ? candidate : latest;
      }

      return candidate.id < latest.id ? candidate : latest;
    }, undefined);
  }

  static summarize(session: ChatSession): string {
    const latestTurn = session.turns[session.turns.length - 1];
    const latestPrompt = latestTurn ? truncate(latestTurn.prompt, 44) : 'no turns yet';
    return `${session.turns.length} turns • ${latestPrompt}`;
  }

  static buildTurnSummary(input: BuildChatTurnSummaryInput) {
    const delegations = input.delegation?.records.map((record) => (
      omit(record, ['trace', 'model', 'provider'])
    ));

    return {
      id: input.id,
      prompt: input.prompt,
      outcome: input.result.outcome,
      summary: input.result.summary,
      steps: TraceSummaryService.default().countAssistantSteps(input.result.trace),
      traceFile: input.traceFile,
      events:
        typeof input.traceSummarizerRegistry?.summarizeTrace === 'function'
          ? input.traceSummarizerRegistry.summarizeTrace(input.result.trace)
          : TraceSummaryService.default().summarizeTrace(input.result.trace),
      presentation: ConversationTurnPresentationService.project({
        turnId: input.id,
        trace: input.result.trace,
      }),
      agent: input.agentSnapshot ? {
        id: input.agentSnapshot.agentProfileId,
        name: input.agentSnapshot.agentName,
        modeAlias: input.agentSnapshot.modeAlias,
        source: input.agentSnapshot.source,
        definitionHash: input.agentSnapshot.definitionHash,
      } : undefined,
      agentSnapshot: input.agentSnapshot,
      ...(delegations?.length ? { delegations } : {}),
    };
  }

  static applyCompactedHistory(input: ApplyCompactedChatSessionHistoryInput): ChatSession {
    const messages = ConversationLines.fromHistory(input.compacted.history);
    return {
      ...input.session,
      history: input.compacted.history,
      context: input.compacted.context,
      archives: input.compacted.archive.archives,
      messages: input.preserveAcceptedUserMessages
        ? ChatSessionRecords.withAcceptedUserMessages(messages, input.session.messages)
        : messages,
    };
  }

  static applyCompletedTurn(input: ApplyCompletedChatSessionTurnInput): ChatSession {
    return ChatSessionRecords.touch({
      ...ChatSessionRecords.applyCompactedHistory(input),
      lastContinuePrompt: input.prompt,
      lease: undefined,
      turns: [...input.session.turns, input.turn].slice(-8),
    });
  }

  static markAcceptedUserMessage(
    session: ChatSession,
    input: MarkAcceptedConversationUserMessageInput,
  ): ChatSession {
    const message: ConversationLine = {
      id: ChatSessionRecords.acceptedUserMessageId(input.runId),
      role: 'user',
      text: input.prompt,
      isPending: true,
    };

    if (session.messages.some((candidate) => candidate.id === message.id)) {
      return session;
    }

    return ChatSessionRecords.touch({
      ...ChatSessionRecords.markUserActivity(session, input.userActivityAt),
      messages: [
        ...session.messages.filter((candidate) => !ChatSessionRecords.isLiveMessage(candidate)),
        message,
      ],
    });
  }

  static isGenericName(name: string): boolean {
    return /^Session \d+$/.test(name.trim());
  }

  static canAutoRenameAfterFirstUserMessage(session: ChatSession): boolean {
    return ChatSessionRecords.isGenericName(session.name)
      && session.history.filter((message) => message.role === 'user').length === 1;
  }

  private static withAcceptedUserMessages(
    messages: ConversationLine[],
    currentMessages: ConversationLine[],
  ): ConversationLine[] {
    const acceptedMessages = currentMessages.filter((message) => (
      ChatSessionRecords.isAcceptedUserMessage(message)
      && !messages.some((candidate) => candidate.id === message.id)
    ));

    return acceptedMessages.length ? [...messages, ...acceptedMessages] : messages;
  }

  static markAcceptedUserMessageFailed(
    session: ChatSession,
    input: MarkAcceptedConversationUserMessageFailedInput,
  ): ChatSession {
    const acceptedId = ChatSessionRecords.acceptedUserMessageId(input.runId);
    const failureId = input.failureMessage.id;
    const messages = session.messages
      .filter((message) => message.id !== failureId)
      .map((message) => {
        if (message.id !== acceptedId) {
          return message;
        }

        const { isPending: _isPending, ...settledMessage } = message;
        return settledMessage;
      });

    return ChatSessionRecords.touch({
      ...session,
      messages: [...messages, input.failureMessage],
    });
  }

  private static acceptedUserMessageId(runId: string): string {
    return `accepted-user-${runId}`;
  }

  private static normalizeUserActivityAt(value: string): string {
    const parsed = dayjs(value);
    if (!parsed.isValid()) {
      throw new Error('User activity timestamp must be a valid datetime.');
    }
    return parsed.toISOString();
  }

  private static readResumeTimestamp(
    session: ChatSessionResumeCandidate,
    useUserActivity: boolean,
  ): number {
    if (useUserActivity) {
      return ChatSessionRecords.readTimestamp(session.lastUserActivityAt) ?? Number.NEGATIVE_INFINITY;
    }

    return ChatSessionRecords.readTimestamp(session.updatedAt)
      ?? ChatSessionRecords.readTimestamp(session.createdAt)
      ?? Number.NEGATIVE_INFINITY;
  }

  private static readTimestamp(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.valueOf() : undefined;
  }

  private static isAcceptedUserMessage(message: ConversationLine): boolean {
    return message.role === 'user' && message.isPending === true && message.id.startsWith('accepted-user-');
  }

  private static isLiveMessage(message: ConversationLine): boolean {
    return message.id.startsWith('live-');
  }
}
