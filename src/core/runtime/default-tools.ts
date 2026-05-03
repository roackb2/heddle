import { join } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { createToolkitToolBundle, type ToolToolkit } from '../tools/toolkit.js';
import { codingFilesToolkit } from '../tools/toolkits/coding-files/toolkit.js';
import { externalContextToolkit } from '../tools/toolkits/external-context/toolkit.js';
import { knowledgeToolkit } from '../tools/toolkits/knowledge/toolkit.js';
import { internalToolkit } from '../tools/toolkits/internal/toolkit.js';
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
  return [
    codingFilesToolkit,
    externalContextToolkit,
    knowledgeToolkit,
    createDefaultInternalToolkit({ includePlanTool: args.includePlanTool }),
  ];
}

function createDefaultInternalToolkit(args: {
  includePlanTool?: boolean;
}): ToolToolkit {
  if (args.includePlanTool ?? true) {
    return internalToolkit;
  }

  return {
    id: internalToolkit.id,
    createTools(context) {
      return internalToolkit.createTools(context).filter((tool) => tool.name !== 'update_plan');
    },
  };
}
