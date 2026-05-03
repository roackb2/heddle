import type { ToolToolkit } from '../../toolkit.js';
import { updatePlanTool } from './update-plan.js';

export const internalToolkit: ToolToolkit = {
  id: 'internal',
  createTools() {
    return [updatePlanTool];
  },
};
