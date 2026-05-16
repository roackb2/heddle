import { AgentMemoryCheckpointTracker } from '../memory/index.js';
import { AgentMutationTracker } from '../mutation/index.js';
import { AgentPlanStateParser } from '../planning/index.js';
import { AgentRunFinisher } from '../finish/index.js';
import { AgentToolDispatcher } from './tool-dispatcher.js';
import type {
  AgentToolTurnResult,
  ExecuteAgentToolTurnArgs,
  HandleAgentToolResultArgs,
  HandleAgentToolTurnArgs,
} from './types.js';
import type { RunResult, ToolResult } from '@/core/types.js';

/**
 * Owns assistant tool-call turns inside the agent loop.
 */
export class AgentToolTurnService {
  static async handle(args: HandleAgentToolTurnArgs): Promise<AgentToolTurnResult> {
    const { context, response } = args;
    const toolCalls = response.toolCalls ?? [];
    context.record({
      type: 'assistant.turn',
      content: response.content ?? '',
      diagnostics: response.diagnostics,
      requestedTools: true,
      toolCalls,
      step: context.state.step,
      timestamp: context.now(),
    });

    context.messages.push({
      role: 'assistant',
      content: response.content ?? '',
      toolCalls,
    });

    for (const call of toolCalls) {
      const toolCallResult = await AgentToolTurnService.execute({ context, call });
      if (toolCallResult) {
        return toolCallResult;
      }
    }

    return 'continue';
  }

  private static async execute(args: ExecuteAgentToolTurnArgs): Promise<RunResult | undefined> {
    const { context, call } = args;
    const interrupted = AgentRunFinisher.maybeInterrupted(context, 'Agent run interrupted before tool execution');
    if (interrupted) {
      return interrupted;
    }

    const tool = context.registry.get(call.tool);
    if (tool) {
      context.onToolCalling?.(call, context.state.step, tool);
    }
    const toolStartTime = Date.now();

    const approvalDeniedResult = await AgentToolDispatcher.maybeDenyToolCall({
      call,
      tool,
      step: context.state.step,
      now: context.now,
      approveToolCall: context.approveToolCall,
      approvalPolicies: context.approvalPolicies,
      workspaceRoot: context.workspaceRoot,
      record: context.record,
      log: context.log,
    });
    if (approvalDeniedResult) {
      const durationMs = Date.now() - toolStartTime;
      context.onToolCompleted?.(call, approvalDeniedResult, context.state.step, durationMs);
      return AgentToolTurnService.handleDeniedResult(context, call.id, approvalDeniedResult);
    }

    const execution = await AgentToolDispatcher.executeToolCallWithFallback({
      call,
      step: context.state.step,
      now: context.now,
      registry: context.registry,
      seenToolCalls: context.seenToolCalls,
      approveToolCall: context.approveToolCall,
      approvalPolicies: context.approvalPolicies,
      workspaceRoot: context.workspaceRoot,
      record: context.record,
      log: context.log,
    });

    const durationMs = Date.now() - toolStartTime;
    context.state.executedToolCalls++;
    context.onToolCompleted?.(execution.effectiveCall, execution.result, context.state.step, durationMs);

    return AgentToolTurnService.handleExecutedResult({
      context,
      effectiveCall: execution.effectiveCall,
      toolCallId: call.id,
      result: execution.result,
    });
  }

  private static handleDeniedResult(
    context: ExecuteAgentToolTurnArgs['context'],
    toolCallId: string,
    result: ToolResult,
  ): RunResult | undefined {
    context.state.consecutiveErrors++;

    context.messages.push({
      role: 'tool',
      content: JSON.stringify(result),
      toolCallId,
    });
    return undefined;
  }

  private static handleExecutedResult(args: HandleAgentToolResultArgs): RunResult | undefined {
    const { context, effectiveCall, toolCallId, result } = args;
    if (!result.ok) {
      const maybeFailure = AgentToolTurnService.handleFailedExecution(context, result);
      if (maybeFailure) {
        return maybeFailure;
      }
    } else {
      context.state.consecutiveErrors = 0;
      AgentMutationTracker.trackToolResult({ state: context.mutation, effectiveCall, result });
      AgentMemoryCheckpointTracker.trackToolResult({ context, effectiveCall, result });
      if (effectiveCall.tool === 'update_plan') {
        context.state.activePlan = AgentPlanStateParser.parse({ output: result.output });
      }
    }

    context.messages.push({
      role: 'tool',
      content: JSON.stringify(result),
      toolCallId,
    });
    AgentToolTurnService.pushHostRequirementReminders(context);
    return undefined;
  }

  private static handleFailedExecution(context: ExecuteAgentToolTurnArgs['context'], _result: ToolResult): RunResult | undefined {
    context.state.consecutiveErrors++;
    return undefined;
  }

  private static pushHostRequirementReminders(context: ExecuteAgentToolTurnArgs['context']): void {
    const memoryReminder = AgentMemoryCheckpointTracker.buildReminder(context);
    if (memoryReminder && !context.state.reminders.memoryCheckpointSent) {
      context.state.reminders.memoryCheckpointSent = true;
      context.messages.push({ role: 'system', content: memoryReminder });
    }
  }

}
