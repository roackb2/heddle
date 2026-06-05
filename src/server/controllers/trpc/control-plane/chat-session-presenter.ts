import type { ChatSession, ConversationDirectShellLineResult } from '@/core/chat/types.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import { ConversationDirectShellLineResultSchema } from '@/core/chat/engine/direct-shell/result-schema.js';
import { ConversationTurnPresentationService } from '@/core/chat/engine/turns/presentation/index.js';
import type {
  ChatSessionDetail,
  ChatSessionMessage,
  ChatSessionView,
  ChatTurnView,
} from '@/server/control-plane-types.js';
import { ControlPlaneSessionDriftService } from '@/server/services/control-plane/session-drift-service.js';
import {
  omitUndefined,
  readBoolean,
  readNumber,
  readObject,
  readString,
} from '@/server/helpers/control-plane-read-values.js';

type ChatSessionContextView = NonNullable<ChatSessionView['context']>;

// Compatibility presenter for legacy session records. Avoid adding or growing
// this layer: downstream clients should consume the same domain-owned shape
// whenever the shape can be unified, optionally guarded by a shared Zod schema.
// Only remap fields when two domains truly need different vocabulary or
// domain-specific fields that cannot be composed into a shared upstream object.
// For long or nested payloads, prefer composing shared sub-objects over
// reassigning every field; converters should not hide the real behavior or
// policy owner behind meaningless formatter/presenter/mapper code.
export class ControlPlaneChatSessionPresenter {
  static projectView(raw: unknown | ChatSession): ChatSessionView[] {
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
    const queuedPrompts = Array.isArray(candidate.queuedPrompts) ? candidate.queuedPrompts : [];
    const lastTurn = readObject(turns.at(-1));
    const context = readObject(candidate.context);
    const request = readObject(context?.request);
    const usage = readObject(request?.usage);
    const compaction = readObject(context?.compaction);
    const archive = readObject(context?.archive);
    const archives = Array.isArray(candidate.archives) ? candidate.archives.map(readObject).filter(Boolean) : [];
    const rawCompactionStatus = readString(compaction?.status);
    const compactionStatus: NonNullable<ChatSessionContextView['compaction']>['status'] =
      rawCompactionStatus === 'idle' || rawCompactionStatus === 'running' || rawCompactionStatus === 'failed' ?
        rawCompactionStatus
      : undefined;
    const requestView = omitEmpty({
      estimatedTokens: readNumber(request?.estimatedTokens),
      toolNames: readStringArray(request?.toolNames),
      goal: readString(request?.goal),
      usage: omitEmpty({
        inputTokens: readNumber(usage?.inputTokens),
        outputTokens: readNumber(usage?.outputTokens),
        totalTokens: readNumber(usage?.totalTokens),
        cachedInputTokens: readNumber(usage?.cachedInputTokens),
        reasoningTokens: readNumber(usage?.reasoningTokens),
      }),
    });
    const compactionView = omitEmpty({
      compactedMessages: readNumber(compaction?.compactedMessages),
      compactedAt: readString(compaction?.compactedAt),
      status: compactionStatus,
      error: readString(compaction?.error),
    });
    const archiveView = omitEmpty({
      count: readNumber(archive?.count),
      currentSummaryPath: readString(archive?.currentSummaryPath),
      lastArchivePath: readString(archive?.lastArchivePath),
    });

    const contextView =
      context ?
        omitUndefined({
          estimatedHistoryTokens: readNumber(context.estimatedHistoryTokens),
          request: requestView,
          compaction: compactionView,
          archive: archiveView,
        })
      : undefined;
    const archiveViews = archives.flatMap((archive) => {
      const archiveObject = readObject(archive);
      if (!archiveObject) {
        return [];
      }

      const id = readString(archiveObject.id);
      const path = readString(archiveObject.path);
      const summaryPath = readString(archiveObject.summaryPath);
      const messageCount = readNumber(archiveObject.messageCount);
      const createdAt = readString(archiveObject.createdAt);
      if (!id || !path || !summaryPath || messageCount === undefined || !createdAt) {
        return [];
      }

      return [omitUndefined({
        id,
        path,
        summaryPath,
        shortDescription: readString(archiveObject.shortDescription),
        messageCount,
        createdAt,
        summaryModel: readString(archiveObject.summaryModel),
      })];
    });

    return [omitUndefined({
      id,
      name,
      retention: candidate.retention === 'reusable' || candidate.retention === 'one_off' ? candidate.retention : undefined,
      workspaceId: readString(candidate.workspaceId),
      createdAt: readString(candidate.createdAt),
      updatedAt: readString(candidate.updatedAt),
      model: readString(candidate.model),
      reasoningEffort: ControlPlaneChatSessionPresenter.readReasoningEffort(candidate.reasoningEffort),
      driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : undefined,
      driftLevel: ControlPlaneSessionDriftService.readLatestDriftLevel(turns),
      messageCount: messages.length,
      turnCount: turns.length,
      lastPrompt: readString(lastTurn?.prompt),
      lastOutcome: readString(lastTurn?.outcome),
      lastSummary: readString(lastTurn?.summary),
      context: contextView && Object.keys(contextView).length > 0 ? contextView : undefined,
      archives: archiveViews.length > 0 ? archiveViews : undefined,
      queuedPromptCount: queuedPrompts.length,
    })];
  }

  static projectDetail(raw: unknown | ChatSession): ChatSessionDetail[] {
    const base = ControlPlaneChatSessionPresenter.projectView(raw)[0];
    if (!base || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const candidate = raw as Record<string, unknown>;
    const messages = Array.isArray(candidate.messages) ? candidate.messages.flatMap((message) => ControlPlaneChatSessionPresenter.projectMessage(message)) : [];
    const turns = Array.isArray(candidate.turns) ? candidate.turns.flatMap((turn) => ControlPlaneChatSessionPresenter.projectTurnView(turn)) : [];
    const queuedPrompts = Array.isArray(candidate.queuedPrompts)
      ? candidate.queuedPrompts.flatMap((item) => ControlPlaneChatSessionPresenter.projectQueuedPrompt(item))
      : [];

    return [{
      ...base,
      messages,
      turns,
      lastContinuePrompt: readString(candidate.lastContinuePrompt),
      queuedPrompts,
    }];
  }

  private static projectQueuedPrompt(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const candidate = raw as Record<string, unknown>;
    const id = readString(candidate.id);
    const prompt = readString(candidate.prompt);
    const createdAt = readString(candidate.createdAt);
    const updatedAt = readString(candidate.updatedAt);
    if (!id || !prompt || !createdAt || !updatedAt) {
      return [];
    }

    return [{
      id,
      prompt,
      createdAt,
      updatedAt,
    }];
  }

  private static projectMessage(raw: unknown): ChatSessionMessage[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const candidate = raw as Record<string, unknown>;
    const id = readString(candidate.id);
    const role = candidate.role === 'user' || candidate.role === 'assistant' ? candidate.role : undefined;
    const text = readString(candidate.text);
    if (!id || !role || !text) {
      return [];
    }

    return [{
      id,
      role,
      text,
      isStreaming: readBoolean(candidate.isStreaming),
      isPending: readBoolean(candidate.isPending),
      directShellResult: ControlPlaneChatSessionPresenter.projectDirectShellResult(candidate.directShellResult),
    }];
  }

  private static projectDirectShellResult(raw: unknown): ConversationDirectShellLineResult | undefined {
    const directShellResult = ConversationDirectShellLineResultSchema.safeParse(raw);
    return directShellResult.success ? directShellResult.data : undefined;
  }

  private static projectTurnView(raw: unknown): ChatTurnView[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const candidate = raw as Record<string, unknown>;
    const id = readString(candidate.id);
    const prompt = readString(candidate.prompt);
    const outcome = readString(candidate.outcome);
    const summary = readString(candidate.summary);
    const traceFile = readString(candidate.traceFile);
    const steps = readNumber(candidate.steps);
    const events = Array.isArray(candidate.events) ? candidate.events.filter((event): event is string => typeof event === 'string') : [];
    if (!id || !prompt || !outcome || !summary || !traceFile || steps === undefined) {
      return [];
    }

    return [{
      id,
      prompt,
      outcome,
      summary,
      steps,
      traceFile,
      events,
      presentation: ConversationTurnPresentationService.read(candidate.presentation),
    }];
  }

  private static readReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'ultrahigh' ? value : undefined;
  }
}

function omitEmpty<T extends Record<string, unknown>>(value: T): T | undefined {
  const compact = omitUndefined(value);
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}
