import { updatePlanTool } from '../update-plan.js';
import type { ToolToolkit } from '../toolkit.js';

export const planningToolkit: ToolToolkit = {
  id: 'planning',
  createTools() {
    return [updatePlanTool];
  },
};
