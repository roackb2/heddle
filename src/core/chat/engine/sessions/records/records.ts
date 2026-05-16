/**
 * Pure chat-session record domain behavior.
 *
 * This class has no storage or host dependencies. Keep reusable record
 * creation, timestamp, naming, and summary semantics here so the stateful
 * session service can compose them without growing scattered helper functions.
 */
import { truncate } from '@/core/utils/text.js';
import type { ChatSession, ConversationLine } from '@/core/chat/types.js';
import { countAssistantSteps, summarizeTrace } from '@/core/observability/trace-summarizers.js';
import { ConversationLines } from './conversation-lines.js';
import type {
  ApplyCompactedChatSessionHistoryInput,
  ApplyCompletedChatSessionTurnInput,
  BuildChatTurnSummaryInput,
  CreateChatSessionRecordOptions,
} from './types.js';

export class ChatSessionRecords {
  static createInitialMessages(apiKeyPresent: boolean): ConversationLine[] {
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

  static create(options: CreateChatSessionRecordOptions): ChatSession {
    const now = new Date().toISOString();
    return {
      id: options.id,
      name: options.name,
      retention: options.retention ?? 'reusable',
      workspaceId: options.workspaceId,
      history: [],
      messages: ChatSessionRecords.createInitialMessages(options.apiKeyPresent),
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
      steps: countAssistantSteps(input.result.trace),
      traceFile: input.traceFile,
      events:
        typeof input.traceSummarizerRegistry?.summarizeTrace === 'function'
          ? input.traceSummarizerRegistry.summarizeTrace(input.result.trace)
          : summarizeTrace(input.result.trace),
    };
  }

  static applyCompactedHistory(input: ApplyCompactedChatSessionHistoryInput): ChatSession {
    return {
      ...input.session,
      history: input.compacted.history,
      context: input.compacted.context,
      archives: input.compacted.archive.archives,
      messages: ConversationLines.fromHistory(input.compacted.history),
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

  static isGenericName(name: string): boolean {
    return /^Session \d+$/.test(name.trim());
  }
}
