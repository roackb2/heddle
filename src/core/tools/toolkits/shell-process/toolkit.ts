import type { ToolToolkit } from '../../toolkit.js';
import { createRunShellInspectTool, createRunShellMutateTool } from './run-shell.js';

export const shellProcessToolkit: ToolToolkit = {
  id: 'shell-process',
  createTools(context) {
    return [
      createRunShellInspectTool({ cwd: context.workspaceRoot }),
      createRunShellMutateTool({ cwd: context.workspaceRoot }),
    ];
  },
};
