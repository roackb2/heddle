import type { ToolToolkit } from '../../toolkit.js';
import { createWorkingEnvironmentTool } from './working-environment.js';

export const codingAwarenessToolkit: ToolToolkit = {
  id: 'coding.awareness',
  createTools(context) {
    return [
      createWorkingEnvironmentTool({ workspaceRoot: context.workspaceRoot }),
    ];
  },
};
