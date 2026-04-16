// ---------------------------------------------------------------------------
// Tool: update_plan
// Record a concise working plan with item statuses for substantial tasks.
// ---------------------------------------------------------------------------

import type { ToolDefinition, ToolResult } from '../../types.js';

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export type PlanItem = {
  step: string;
  status: PlanItemStatus;
};

type UpdatePlanInput = {
  explanation?: string;
  plan: PlanItem[];
};

export const updatePlanTool: ToolDefinition = {
  name: 'update_plan',
  description:
    'Record or revise a short working plan for substantial multi-step tasks. Use this when the task has multiple concrete steps, when you need to show progress explicitly, or when you want the operator to see what remains. Keep the plan short and practical. Each item must have a step string and a status of pending, in_progress, or completed. At most one item may be in_progress at a time. Returns the saved plan back.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      explanation: {
        type: 'string',
        description: 'Optional one-line note about why the plan changed or what you are doing now.',
      },
      plan: {
        type: 'array',
        description: 'Short checklist of concrete plan items.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: {
              type: 'string',
              description: 'Concrete plan item.',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current status for this plan item.',
            },
          },
          required: ['step', 'status'],
        },
        minItems: 1,
      },
    },
    required: ['plan'],
  },
  async execute(raw: unknown): Promise<ToolResult> {
    if (!isUpdatePlanInput(raw)) {
      return {
        ok: false,
        error:
          'Invalid input for update_plan. Required field: plan. Optional field: explanation. Each plan item must have step and status (pending, in_progress, completed), with at most one in_progress item.',
      };
    }

    return { ok: true, output: raw };
  },
};

function isUpdatePlanInput(raw: unknown): raw is UpdatePlanInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'explanation' && key !== 'plan')) {
    return false;
  }

  if (input.explanation !== undefined && typeof input.explanation !== 'string') {
    return false;
  }

  if (!Array.isArray(input.plan) || input.plan.length === 0) {
    return false;
  }

  let inProgressCount = 0;
  for (const item of input.plan) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    if (typeof candidate.step !== 'string') {
      return false;
    }

    if (
      candidate.status !== 'pending' &&
      candidate.status !== 'in_progress' &&
      candidate.status !== 'completed'
    ) {
      return false;
    }

    if (candidate.status === 'in_progress') {
      inProgressCount++;
    }
  }

  return inProgressCount <= 1;
}
