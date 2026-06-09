/**
 * Pure chat-session record domain behavior.
 *
 * This class has no storage or host dependencies. Keep reusable record
 * creation, timestamp, naming, and summary semantics here so the stateful
 * session service can compose them without growing scattered helper functions.
 */
import { truncate } from '@/core/utils/text.js';
import type { ChatSession, ConversationLine } from '@/core/chat/types.js';
import { TraceSummaryService } from '@/core/observability/index.js';
import { ConversationTurnPresentationService } from '@/core/chat/engine/turns/presentation/index.js';
import { ConversationLines } from './conversation-lines.js';
import type {
  ApplyCompactedChatSessionHistoryInput,
  ApplyCompletedChatSessionTurnInput,
  BuildChatTurnSummaryInput,
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
      history: [],
      messages: [],
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
      queuedPrompts: [],
    };
  }

  static touch(session: ChatSession): ChatSession {
    return { ...session, updatedAt: new Date().toISOString() };
  }

  static summarize(session: ChatSession): string {
    const latestTurn = session.turns[session.turns.length - 1];
    const latestPrompt = latestTurn ? truncate(latestTurn.prompt, 44) : 'no turns yet';
    return `${session.turns.length} turns • ${latestPrompt}`;
  }

  static buildTurnSummary(input: BuildChatTurnSummaryInput) {
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
      ...session,
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

  private static isAcceptedUserMessage(message: ConversationLine): boolean {
    return message.role === 'user' && message.isPending === true && message.id.startsWith('accepted-user-');
  }

  private static isLiveMessage(message: ConversationLine): boolean {
    return message.id.startsWith('live-');
  }
}
