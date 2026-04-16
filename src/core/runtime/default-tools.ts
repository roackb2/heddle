import { join } from 'node:path';
import type { ToolDefinition } from '../../types.js';
import { editFileTool } from '../tools/edit-file.js';
import { listFilesTool } from '../tools/list-files.js';
import {
  createEditMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
} from '../tools/memory-notes.js';
import { readFileTool } from '../tools/read-file.js';
import { reportStateTool } from '../tools/report-state.js';
import { createRunShellInspectTool, createRunShellMutateTool } from '../tools/run-shell.js';
import { createSearchFilesTool } from '../tools/search-files.js';
import { updatePlanTool } from '../tools/update-plan.js';
import { createViewImageTool } from '../tools/view-image.js';
import { createWebSearchTool } from '../tools/web-search.js';

export type DefaultAgentToolsOptions = {
  model: string;
  apiKey?: string;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
};

export function createDefaultAgentTools(options: DefaultAgentToolsOptions): ToolDefinition[] {
  const memoryRoot =
    options.memoryDir ??
    join(options.workspaceRoot ?? process.cwd(), options.stateDir ?? '.heddle', 'memory');
  const tools: ToolDefinition[] = [
    listFilesTool,
    readFileTool,
    editFileTool,
    createSearchFilesTool({ excludedDirs: options.searchIgnoreDirs }),
    createWebSearchTool({
      model: options.model,
      apiKey: options.apiKey,
    }),
    createViewImageTool({
      model: options.model,
      apiKey: options.apiKey,
    }),
    createListMemoryNotesTool({ memoryRoot }),
    createReadMemoryNoteTool({ memoryRoot }),
    createSearchMemoryNotesTool({ memoryRoot }),
    createEditMemoryNoteTool({ memoryRoot }),
    reportStateTool,
  ];

  if (options.includePlanTool ?? true) {
    tools.push(updatePlanTool);
  }

  tools.push(createRunShellInspectTool(), createRunShellMutateTool());
  return tools;
}
