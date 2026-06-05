/**
 * Owns durable presentation metadata extracted from a completed turn trace.
 *
 * This is not model transcript history and it is not host UI rendering. Core
 * owns this compact, stable activity contract so terminal and browser clients
 * can reconstruct the same conversation-adjacent tool activity without parsing
 * raw trace files or duplicating tool payload semantics.
 */
import dayjs from 'dayjs';
import compact from 'lodash/compact.js';
import isPlainObject from 'lodash/isPlainObject.js';
import isString from 'lodash/isString.js';
import orderBy from 'lodash/orderBy.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { TraceEvent, ToolCall } from '@/core/types.js';
import { ToolActivitySummarizer } from '@/core/live/index.js';
import type {
  ConversationTurnApprovalTimelineItem,
  ConversationTurnEditDiffTimelineItem,
  ConversationTurnPresentation,
  ConversationTurnPresentationTimelineItem,
} from '@/core/chat/types.js';
import { ConversationTurnPresentationSchema } from './schema.js';

type ProjectTurnPresentationInput = {
  turnId: string;
  trace: TraceEvent[];
};

export class ConversationTurnPresentationService {
  static project(input: ProjectTurnPresentationInput): ConversationTurnPresentation | undefined {
    const requestedApprovals = input.trace
      .filter((event): event is Extract<TraceEvent, { type: typeof HeddleEventType.toolApprovalRequested }> => (
        event.type === HeddleEventType.toolApprovalRequested
      ));
    const approvalResolutions = new Map(input.trace
      .filter((event): event is Extract<TraceEvent, { type: typeof HeddleEventType.toolApprovalResolved }> => (
        event.type === HeddleEventType.toolApprovalResolved
      ))
      .map((event) => [event.call.id, event]));
    const approvals = requestedApprovals.map((event) => (
      ConversationTurnPresentationService.projectApproval(input.turnId, event, approvalResolutions.get(event.call.id))
    ));
    const editDiffs = compact(input.trace.map((event) => (
      event.type === HeddleEventType.toolCompleted
        ? ConversationTurnPresentationService.projectEditDiff(input.turnId, event)
        : undefined
    )));
    const timelineItems = ConversationTurnPresentationService.sortTimelineItems([...approvals, ...editDiffs]);

    return timelineItems.length > 0 ? { timelineItems } : undefined;
  }

  static read(raw: unknown): ConversationTurnPresentation | undefined {
    const parsed = ConversationTurnPresentationSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  private static projectApproval(
    turnId: string,
    event: Extract<TraceEvent, { type: typeof HeddleEventType.toolApprovalRequested }>,
    resolution: Extract<TraceEvent, { type: typeof HeddleEventType.toolApprovalResolved }> | undefined,
  ): ConversationTurnApprovalTimelineItem {
    const command = ConversationTurnPresentationService.readCommandOrPath(event.call);
    return {
      type: 'approval',
      id: `${turnId}:approval:${event.call.id}`,
      toolCallId: event.call.id,
      tool: event.call.tool,
      summary: ToolActivitySummarizer.summarizeCall(event.call),
      status:
        resolution ? (resolution.approved ? 'approved' : 'denied')
        : 'requested',
      ...(command ? { command } : {}),
      ...(resolution?.reason ? { reason: resolution.reason } : {}),
      step: event.step,
      timestamp: resolution?.timestamp ?? event.timestamp,
    };
  }

  private static projectEditDiff(
    turnId: string,
    event: Extract<TraceEvent, { type: typeof HeddleEventType.toolCompleted }>,
  ): ConversationTurnEditDiffTimelineItem | undefined {
    if (event.call.tool !== 'edit_file' || event.result.ok !== true || !isPlainObject(event.result.output)) {
      return undefined;
    }

    const output = event.result.output as Record<string, unknown>;
    const diff = isPlainObject(output.diff) ? output.diff as Record<string, unknown> : undefined;
    const path = ConversationTurnPresentationService.readNonEmptyString(output.path);
    const patch = ConversationTurnPresentationService.readNonEmptyString(diff?.diff);
    if (!path || !patch) {
      return undefined;
    }

    const action = ConversationTurnPresentationService.readNonEmptyString(output.action);
    return {
      type: 'edit_diff',
      id: `${turnId}:edit-diff:${event.call.id}`,
      toolCallId: event.call.id,
      path,
      ...(action ? { action } : {}),
      patch,
      truncated: diff?.truncated === true,
      step: event.step,
      timestamp: event.timestamp,
    };
  }

  private static sortTimelineItems(
    timelineItems: ConversationTurnPresentationTimelineItem[],
  ): ConversationTurnPresentationTimelineItem[] {
    return orderBy(timelineItems, [
      (item) => dayjs(item.timestamp).valueOf(),
      (item) => item.step ?? Number.MAX_SAFE_INTEGER,
      'id',
    ], ['asc', 'asc', 'asc']);
  }

  private static readCommandOrPath(call: ToolCall): string | undefined {
    if (!isPlainObject(call.input)) {
      return undefined;
    }

    const input = call.input as Record<string, unknown>;
    return ConversationTurnPresentationService.readNonEmptyString(input.command)
      ?? ConversationTurnPresentationService.readNonEmptyString(input.path);
  }

  private static readNonEmptyString(value: unknown): string | undefined {
    return isString(value) && value.trim().length > 0 ? value.trim() : undefined;
  }
}
