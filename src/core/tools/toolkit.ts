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
  return args.toolkits.flatMap((toolkit) => toolkit.createTools(args.context));
}
