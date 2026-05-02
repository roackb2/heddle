import { createDefaultAgentTools } from '../runtime/default-tools.js';
import type { ProviderCredentialSource } from '../runtime/api-keys.js';
import type { ToolDefinition } from '../types.js';

export type CreateChatTurnToolsArgs = {
  model: string;
  apiKey?: string;
  providerCredentialSource: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot: string;
  memoryDir: string;
};

export function createChatTurnTools(args: CreateChatTurnToolsArgs): ToolDefinition[] {
  return createDefaultAgentTools({
    model: args.model,
    apiKey: args.apiKey,
    providerCredentialSource: args.providerCredentialSource,
    credentialStorePath: args.credentialStorePath,
    workspaceRoot: args.workspaceRoot,
    memoryDir: args.memoryDir,
    searchIgnoreDirs: [],
    includePlanTool: true,
  });
}

export function listChatTurnToolNames(tools: ToolDefinition[]): string[] {
  return tools.map((tool) => tool.name);
}
