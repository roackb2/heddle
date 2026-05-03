import { createRunShellInspectTool, createRunShellMutateTool } from '../run-shell.js';
import type { ToolToolkit } from '../toolkit.js';

export const shellProcessToolkit: ToolToolkit = {
  id: 'shell.process',
  createTools(context) {
    return [
      createRunShellInspectTool({ cwd: context.workspaceRoot }),
      createRunShellMutateTool({ cwd: context.workspaceRoot }),
    ];
  },
};
