import { join } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { createEditFileTool } from '../tools/edit-file.js';
import { createListFilesTool } from '../tools/list-files.js';
import {
  createEditMemoryNoteTool,
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
} from '../tools/memory-notes.js';
import { createReadFileTool } from '../tools/read-file.js';
import { createMemoryCheckpointTool } from '../tools/memory-checkpoint.js';
import { createRecordKnowledgeTool } from '../tools/record-knowledge.js';
import { reportStateTool } from '../tools/report-state.js';
import { createRunShellInspectTool, createRunShellMutateTool } from '../tools/run-shell.js';
import { createSearchFilesTool } from '../tools/search-files.js';
import { updatePlanTool } from '../tools/update-plan.js';
import { createViewImageTool } from '../tools/view-image.js';
import { createWebSearchTool } from '../tools/web-search.js';
import type { ProviderCredentialSource } from './api-keys.js';

export type DefaultAgentToolsOptions = {
  model: string;
  apiKey?: string;
  providerCredentialSource?: ProviderCredentialSource;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  memoryMode?: 'none' | 'read-and-record' | 'maintainer' | 'legacy-full';
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
};

export function createDefaultAgentTools(options: DefaultAgentToolsOptions): ToolDefinition[] {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const memoryRoot =
    options.memoryDir ??
    join(workspaceRoot, options.stateDir ?? '.heddle', 'memory');
  const memoryMode = options.memoryMode ?? 'read-and-record';
  const tools: ToolDefinition[] = [
    createListFilesTool({ workspaceRoot }),
    createReadFileTool({ workspaceRoot }),
    createEditFileTool({ workspaceRoot }),
    createSearchFilesTool({ excludedDirs: options.searchIgnoreDirs, workspaceRoot }),
    createWebSearchTool({
      model: options.model,
      apiKey: options.apiKey,
      providerCredentialSource: options.providerCredentialSource,
    }),
    createViewImageTool({
      model: options.model,
      apiKey: options.apiKey,
      providerCredentialSource: options.providerCredentialSource,
      workspaceRoot,
    }),
    reportStateTool,
  ];

  tools.push(...createMemoryTools(memoryRoot, memoryMode));

  if (options.includePlanTool ?? true) {
    tools.push(updatePlanTool);
  }

  tools.push(createRunShellInspectTool({ cwd: workspaceRoot }), createRunShellMutateTool({ cwd: workspaceRoot }));
  return tools;
}

function createMemoryTools(memoryRoot: string, mode: NonNullable<DefaultAgentToolsOptions['memoryMode']>): ToolDefinition[] {
  if (mode === 'none') {
    return [];
  }

  const readTools = [
    createListMemoryNotesTool({ memoryRoot }),
    createReadMemoryNoteTool({ memoryRoot }),
    createSearchMemoryNotesTool({ memoryRoot }),
  ];

  if (mode === 'read-and-record') {
    return [...readTools, createMemoryCheckpointTool({ memoryRoot }), createRecordKnowledgeTool({ memoryRoot })];
  }

  if (mode === 'maintainer' || mode === 'legacy-full') {
    return [...readTools, createEditMemoryNoteTool({ memoryRoot })];
  }

  const exhaustive: never = mode;
  throw new Error(`Unsupported memory mode: ${exhaustive}`);
}
