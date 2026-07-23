import { AgentRunContextBuilder } from './context/index.js';
import { AgentModelTurnService } from './model/index.js';
import { AgentToolTurnService } from './tools/index.js';
import { AgentRunFinisher } from './finish/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { RunResult } from '@/core/types.js';
import type { RunAgentOptions, AgentRunContext } from './types.js';

/**
 * Owns the low-level model/tool loop for one agent run.
 */
export class AgentRunService {
  static async run(options: RunAgentOptions): Promise<RunResult> {
    const context = AgentRunContextBuilder.create(options);

    context.log.info({
      goal: options.goal,
      maxSteps: context.maxSteps,
      maxToolConcurrency: context.maxToolConcurrency,
      tools: context.registry.names(),
    }, 'Agent run started');
    context.live.trace({ type: HeddleEventType.runStarted, goal: options.goal, timestamp: context.now() });

    while (!context.budget.exhausted()) {
      const interrupted = AgentRunFinisher.maybeInterrupted(context, 'Agent run interrupted before next step');
      if (interrupted) {
        return interrupted;
      }

      AgentRunService.beginStep(context);
      const responseResult = await AgentModelTurnService.request({ context });
      if (AgentRunFinisher.isRunResult(responseResult)) {
        return responseResult;
      }

      if (responseResult.toolCalls && responseResult.toolCalls.length > 0) {
        const toolTurnResult = await AgentToolTurnService.handle({ context, response: responseResult });
        if (toolTurnResult !== 'continue') {
          return toolTurnResult;
        }
        continue;
      }

      const finalResponse = AgentRunFinisher.finishAssistantResponse(context, responseResult);
      if (finalResponse === 'continue') {
        continue;
      }

      return finalResponse;
    }

    return AgentRunFinisher.maxSteps(context);
  }

  private static beginStep(context: AgentRunContext): void {
    context.state.step++;
    context.budget.step();
    context.log.debug({ step: context.state.step, budgetRemaining: context.budget.remaining() }, 'Calling LLM');
  }
}
