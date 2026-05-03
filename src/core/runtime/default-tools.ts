import { join } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { createToolkitToolBundle, type ToolToolkit } from '../tools/toolkit.js';
import { codingFilesToolkit } from '../tools/toolkits/coding-files.js';
import { imageToolkit } from '../tools/toolkits/image.js';
import { memoryToolkit } from '../tools/toolkits/memory.js';
import { planningToolkit } from '../tools/toolkits/planning.js';
import { shellProcessToolkit } from '../tools/toolkits/shell-process.js';
import { webToolkit } from '../tools/toolkits/web.js';
import type { ProviderCredentialSource } from './api-keys.js';

export type DefaultAgentToolsOptions = {
  model: string;
  apiKey?: string;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot?: string;
  stateDir?: string;
  memoryDir?: string;
  memoryMode?: 'none' | 'read-and-record' | 'maintainer' | 'legacy-full';
  searchIgnoreDirs?: string[];
  includePlanTool?: boolean;
};

export function createDefaultAgentTools(options: DefaultAgentToolsOptions): ToolDefinition[] {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const memoryDir =
    options.memoryDir ??
    join(workspaceRoot, options.stateDir ?? '.heddle', 'memory');
  const memoryMode = options.memoryMode ?? 'read-and-record';

  return createToolkitToolBundle({
    toolkits: createDefaultToolkits({ includePlanTool: options.includePlanTool }),
    context: {
      workspaceRoot,
      model: options.model,
      apiKey: options.apiKey,
      providerCredentialSource: options.providerCredentialSource,
      credentialStorePath: options.credentialStorePath,
      memoryDir,
      memoryMode,
      searchIgnoreDirs: options.searchIgnoreDirs,
    },
  });
}

function createDefaultToolkits(args: {
  includePlanTool?: boolean;
}): ToolToolkit[] {
  const toolkits: ToolToolkit[] = [
    codingFilesToolkit,
    webToolkit,
    imageToolkit,
    memoryToolkit,
  ];

  if (args.includePlanTool ?? true) {
    toolkits.push(planningToolkit);
  }

  toolkits.push(shellProcessToolkit);
  return toolkits;
}
