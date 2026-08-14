import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
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

export type NodeMcpJsonToolExecutionContext<TTool extends string> = {
  capability: VerifiedMcpCapability<TTool>;
  signal: AbortSignal;
};

/**
 * One product-owned JSON tool exposed through the standard Node MCP edge.
 *
 * The generic toolset owns capability admission, cancellation composition,
 * lifetime checks, safe failures, and JSON result projection. The definition
 * owns only product vocabulary, validation, annotations, and behavior.
 */
export type NodeMcpJsonToolDefinition<
  TTool extends string,
  TInput extends Record<string, unknown>,
> = {
  name: TTool;
  title?: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  annotations?: ToolAnnotations;
  /** Stable model-visible text; thrown product errors are never reflected. */
  failureMessage: string;
  execute(
    input: TInput,
    context: NodeMcpJsonToolExecutionContext<TTool>,
  ): unknown | Promise<unknown>;
};

export type AnyNodeMcpJsonToolDefinition<TTool extends string> =
  NodeMcpJsonToolDefinition<TTool, Record<string, unknown>>;

export type NodeMcpJsonToolsetConfig<TTool extends string> = {
  serverInfo: Readonly<{ name: string; version: string }>;
  tools: readonly AnyNodeMcpJsonToolDefinition<TTool>[];
  now?: () => Date;
};

export type NodeStreamableHttpMcpServiceConfig<TTool extends string> = {
  capabilityVerifier: McpCapabilityVerifier<TTool>;
  toolset: NodeMcpToolset<TTool>;
  maxBodyBytes?: number;
};
