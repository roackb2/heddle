import type { ToolDefinition } from '../types.js';

export type ToolToolkitContext = {
  workspaceRoot: string;
  model: string;
  apiKey?: string;
  providerCredentialSource?: import('../runtime/api-keys.js').ProviderCredentialSource;
  credentialStorePath?: string;
  memoryDir: string;
  memoryMode: 'none' | 'read-and-record' | 'maintainer' | 'legacy-full';
  searchIgnoreDirs?: string[];
};

export type ToolToolkit = {
  id: string;
  createTools(context: ToolToolkitContext): ToolDefinition[];
};

export function createToolkitToolBundle(args: {
  toolkits: readonly ToolToolkit[];
  context: ToolToolkitContext;
}): ToolDefinition[] {
  const seenToolkitIds = new Set<string>();
  const seenToolNames = new Set<string>();
  const tools: ToolDefinition[] = [];

  for (const toolkit of args.toolkits) {
    if (seenToolkitIds.has(toolkit.id)) {
      throw new Error(`Duplicate toolkit id: ${toolkit.id}`);
    }
    seenToolkitIds.add(toolkit.id);

    const toolkitTools = toolkit.createTools(args.context);
    for (const tool of toolkitTools) {
      if (seenToolNames.has(tool.name)) {
        throw new Error(`Duplicate tool name from toolkits: ${tool.name}`);
      }
      seenToolNames.add(tool.name);
      tools.push(tool);
    }
  }

  return tools;
}
