import type { PlanItem } from '@/core/tools/toolkits/internal/update-plan.js';
import type { AgentPlanState, ParseAgentPlanStateArgs } from './types.js';

const PLAN_ITEM_STATUSES = new Set<PlanItem['status']>(['pending', 'in_progress', 'completed']);

/**
 * Parses update_plan tool output into the agent's active plan state.
 */
export class AgentPlanStateParser {
  static parse(args: ParseAgentPlanStateArgs): AgentPlanState | undefined {
    if (!args.output || typeof args.output !== 'object' || Array.isArray(args.output)) {
      return undefined;
    }

    const candidate = args.output as { explanation?: unknown; plan?: unknown };
    if (!Array.isArray(candidate.plan)) {
      return undefined;
    }

    const items = candidate.plan.flatMap((item) => AgentPlanStateParser.parseItem(item));
    if (items.length === 0) {
      return undefined;
    }

    return {
      explanation: typeof candidate.explanation === 'string' ? candidate.explanation : undefined,
      items,
    };
  }

  private static parseItem(item: unknown): PlanItem[] {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step : undefined;
    const status = (item as { status?: unknown }).status;
    if (!step || typeof status !== 'string' || !PLAN_ITEM_STATUSES.has(status as PlanItem['status'])) {
      return [];
    }

    return [{ step, status: status as PlanItem['status'] }];
  }
}
