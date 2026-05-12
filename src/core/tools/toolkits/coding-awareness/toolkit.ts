import type { ToolToolkit } from '../../toolkit.js';
import { createProjectDashboardTool } from './project-dashboard.js';

export const codingAwarenessToolkit: ToolToolkit = {
  id: 'coding.awareness',
  createTools(context) {
    return [
      createProjectDashboardTool({ workspaceRoot: context.workspaceRoot }),
    ];
  },
};
