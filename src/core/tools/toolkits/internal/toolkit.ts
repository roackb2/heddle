import { createRunShellInspectTool, createRunShellMutateTool } from './run-shell.js';
import type { ToolToolkit } from '../../toolkit.js';
import { updatePlanTool } from './update-plan.js';

export const internalToolkit: ToolToolkit = {
  id: 'internal',
  createTools(context) {
    return [
      updatePlanTool,
      createRunShellInspectTool({ cwd: context.workspaceRoot }),
      createRunShellMutateTool({ cwd: context.workspaceRoot }),
    ];
  },
};
