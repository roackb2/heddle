import { AgentMemoryCheckpointTracker } from '../memory/index.js';
import { AgentMutationTracker } from '../mutation/index.js';
import { AgentPlanStateParser } from '../planning/index.js';
import { AgentRunFinisher } from '../finish/index.js';
import { AgentToolConcurrencyService } from './tool-concurrency-service.js';
import { AgentToolDispatcher } from './tool-dispatcher.js';
import { HeddleEventType } from '@/core/event-types.js';
import type {
  AgentToolTurnResult,
  HandleAgentToolResultArgs,
  HandleAgentToolTurnArgs,
} from './types.js';
import type { RunResult, ToolCall, ToolDefinition, ToolResult } from '@/core/types.js';

type ToolCallScheduleEntry = {
  index: number;
  call: ToolCall;
  tool?: ToolDefinition;
  autonomyEvaluation?: Parameters<typeof AgentToolDispatcher.executeToolCallWithFallback>[0]['autonomyEvaluation'];
};

type ProjectedToolCall = {
  effectiveCall: ToolCall;
  result: ToolResult;
  executed: boolean;
};

/**
 * Owns assistant tool-call turns inside the agent loop.
 */
export class AgentToolTurnService {
  static async handle(args: HandleAgentToolTurnArgs): Promise<AgentToolTurnResult> {
    const { context, response } = args;
    const toolCalls = response.toolCalls ?? [];
    context.live.trace({
      type: HeddleEventType.assistantTurn,
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
      providerContinuation: response.providerContinuation,
    });

    const projectedByIndex = new Map<number, ProjectedToolCall>();
    const scheduledCalls: ToolCallScheduleEntry[] = toolCalls.map((call, index) => ({
      index,
      call,
      tool: context.registry.get(call.tool),
    }));
    const interruptedBeforeScheduling = AgentRunFinisher.maybeInterrupted(
      context,
      'Agent run interrupted before tool scheduling',
    );
    if (interruptedBeforeScheduling) {
      return interruptedBeforeScheduling;
    }

    const executions = await AgentToolConcurrencyService.execute({
      calls: scheduledCalls,
      adapterSupportsParallel:
        context.llm.info?.capabilities.parallelToolCalls === true,
      maxConcurrency: context.maxToolConcurrency,
      isInterrupted: () => AgentRunFinisher.isInterrupted(context),
      prepareStage: async (calls) => {
        const authorizedCalls: ToolCallScheduleEntry[] = [];
        for (const scheduled of calls) {
          if (AgentRunFinisher.isInterrupted(context)) {
            break;
          }

          const authorization = await AgentToolDispatcher.authorizeToolCall({
            call: scheduled.call,
            tool: scheduled.tool,
            step: context.state.step,
            now: context.now,
            approveToolCall: context.approveToolCall,
            approvalPolicies: context.approvalPolicies,
            workspaceRoot: context.workspaceRoot,
            live: context.live,
            log: context.log,
          });
          if (authorization.type === 'denied') {
            projectedByIndex.set(scheduled.index, {
              effectiveCall: scheduled.call,
              result: authorization.result,
              executed: false,
            });
            continue;
          }

          authorizedCalls.push({
            ...scheduled,
            autonomyEvaluation: authorization.autonomyEvaluation,
          });
        }

        return authorizedCalls;
      },
      execute: async (authorized) => await AgentToolDispatcher.executeToolCallWithFallback({
        call: authorized.call,
        autonomyEvaluation: authorized.autonomyEvaluation,
        step: context.state.step,
        now: context.now,
        registry: context.registry,
        seenToolCalls: context.seenToolCalls,
        approveToolCall: context.approveToolCall,
        approvalPolicies: context.approvalPolicies,
        workspaceRoot: context.workspaceRoot,
        abortSignal: context.abortSignal,
        live: context.live,
        log: context.log,
      }),
    });

    executions.forEach((execution, index) => {
      projectedByIndex.set(index, {
        ...execution,
        executed: true,
      });
    });

    const interruptedDuringExecution = AgentRunFinisher.maybeInterrupted(
      context,
      'Agent run interrupted during tool execution',
    );
    if (interruptedDuringExecution) {
      return interruptedDuringExecution;
    }

    for (const [index, call] of toolCalls.entries()) {
      const projected = projectedByIndex.get(index);
      if (!projected) {
        continue;
      }

      if (!projected.executed) {
        AgentToolTurnService.handleDeniedResult(
          context,
          call.id,
          projected.result,
        );
        continue;
      }

      context.state.executedToolCalls++;
      const toolCallResult = AgentToolTurnService.handleExecutedResult({
        context,
        effectiveCall: projected.effectiveCall,
        toolCallId: call.id,
        result: projected.result,
      });
      if (toolCallResult) {
        return toolCallResult;
      }
    }

    return 'continue';
  }

  private static handleDeniedResult(
    context: HandleAgentToolTurnArgs['context'],
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
        if (context.state.activePlan) {
          context.live.activity({
            type: HeddleEventType.planUpdated,
            step: context.state.step,
            ...context.state.activePlan,
          });
        }
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

  private static handleFailedExecution(context: HandleAgentToolTurnArgs['context'], _result: ToolResult): RunResult | undefined {
    context.state.consecutiveErrors++;
    return undefined;
  }

  private static pushHostRequirementReminders(context: HandleAgentToolTurnArgs['context']): void {
    const memoryReminder = AgentMemoryCheckpointTracker.buildReminder(context);
    if (memoryReminder && !context.state.reminders.memoryCheckpointSent) {
      context.state.reminders.memoryCheckpointSent = true;
      context.messages.push({ role: 'system', content: memoryReminder });
    }
  }

}
