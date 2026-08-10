import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  McpCapabilityVerifier,
  VerifiedMcpCapability,
} from '../types.js';

export type NodeMcpToolRegistrationContext<TTool extends string> = {
  server: McpServer;
  capability: VerifiedMcpCapability<TTool>;
  requestSignal: AbortSignal;
};

/** Product-owned model-visible tools plugged into the generic MCP edge. */
export interface NodeMcpToolset<TTool extends string> {
  readonly serverInfo: Readonly<{ name: string; version: string }>;
  registerAllowedTools(
    context: NodeMcpToolRegistrationContext<TTool>,
  ): void;
}

export type NodeStreamableHttpMcpServiceConfig<TTool extends string> = {
  capabilityVerifier: McpCapabilityVerifier<TTool>;
  toolset: NodeMcpToolset<TTool>;
  maxBodyBytes?: number;
};
