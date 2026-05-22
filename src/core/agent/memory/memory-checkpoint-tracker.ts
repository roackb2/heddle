import type { TraceEvent } from '@/core/types.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { CreateAgentMemoryCheckpointStateArgs, TrackAgentMemoryToolResultArgs } from './types.js';
import type { AgentRunContext, AgentMemoryCheckpointState } from '../types.js';

/**
 * Owns in-run memory checkpoint policy and trace events.
 */
export class AgentMemoryCheckpointTracker {
  static createState(args: CreateAgentMemoryCheckpointStateArgs): AgentMemoryCheckpointState {
    return {
      required: args.toolNames.includes('memory_checkpoint') && AgentMemoryCheckpointTracker.hasExplicitMemoryIntent(args.goal),
      completed: false,
    };
  }

  static trackToolResult(args: TrackAgentMemoryToolResultArgs): void {
    AgentMemoryCheckpointTracker.trackCheckpointNeed(args.context, args.effectiveCall.tool);
    AgentMemoryCheckpointTracker.recordMemoryCandidateEvent(args);
    AgentMemoryCheckpointTracker.recordMemoryCheckpointSkippedEvent(args);
  }

  static buildReminder(context: AgentRunContext): string | undefined {
    if (context.state.memoryCheckpoint.required && !context.state.memoryCheckpoint.completed) {
      context.log.info({ step: context.state.step }, 'Reminding agent to run memory checkpoint');
      return 'Before your final answer, call memory_checkpoint exactly once. Use decision "record" if the user asked you to remember a durable preference/workflow/fact or this turn discovered stable reusable workspace knowledge. Use decision "skip" if there is nothing durable to preserve, the fact is speculative/temporary/duplicate, or it should not be stored.';
    }

    return undefined;
  }

  private static recordMemoryCandidateEvent(args: TrackAgentMemoryToolResultArgs): void {
    const { context, effectiveCall, result } = args;
    if (effectiveCall.tool !== 'record_knowledge' && effectiveCall.tool !== 'memory_checkpoint') {
      return;
    }
    if (effectiveCall.tool === 'memory_checkpoint') {
      context.state.memoryCheckpoint.completed = true;
    }

    const output = result.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return;
    }

    const candidateId = (output as Record<string, unknown>).id;
    const path = (output as Record<string, unknown>).path;
    if (typeof candidateId !== 'string' || typeof path !== 'string') {
      return;
    }

    context.live.trace({
      type: HeddleEventType.memoryCandidateRecorded,
      candidateId,
      path,
      step: context.state.step,
      timestamp: context.now(),
    } satisfies TraceEvent);
  }

  private static recordMemoryCheckpointSkippedEvent(args: TrackAgentMemoryToolResultArgs): void {
    const { context, effectiveCall, result } = args;
    if (effectiveCall.tool !== 'memory_checkpoint') {
      return;
    }

    context.state.memoryCheckpoint.completed = true;
    const output = result.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return;
    }

    const decision = (output as Record<string, unknown>).decision;
    const rationale = (output as Record<string, unknown>).rationale;
    if (decision !== 'skip' || typeof rationale !== 'string') {
      return;
    }

    context.live.trace({
      type: HeddleEventType.memoryCheckpointSkipped,
      rationale,
      step: context.state.step,
      timestamp: context.now(),
    } satisfies TraceEvent);
  }

  private static trackCheckpointNeed(context: AgentRunContext, toolName: string): void {
    if (toolName === 'memory_checkpoint') {
      return;
    }
    if (AgentMemoryCheckpointTracker.isMemoryOnlyTool(toolName)) {
      return;
    }
    if (context.registry.get('memory_checkpoint')) {
      context.state.memoryCheckpoint.required = true;
    }
  }

  private static hasExplicitMemoryIntent(goal: string): boolean {
    return /\b(?:remember|note down|keep in memory|use this going forward|going forward|preferred format|preference|don't forget|do not forget|preserve this|save this)\b/i.test(goal);
  }

  private static isMemoryOnlyTool(tool: string): boolean {
    return tool === 'list_memory_notes'
      || tool === 'read_memory_note'
      || tool === 'search_memory_notes'
      || tool === 'record_knowledge'
      || tool === 'memory_checkpoint';
  }
}
