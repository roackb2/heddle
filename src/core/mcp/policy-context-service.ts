import type {
  ToolPolicyEnvironment,
  ToolPolicyHostContext,
  ToolPolicyOperation,
} from '@/core/tools/policy-envelope/types.js';
import type { McpServerConfig } from './types.js';

/**
 * Projects configured MCP execution facts into the shared host-owned policy
 * boundary. It never treats remote tool annotations as authorization facts.
 */
export class McpPolicyContextService {
  static create(args: {
    server: McpServerConfig;
    toolName: string;
    environment?: ToolPolicyEnvironment;
    tenantId?: string;
    operations?: readonly ToolPolicyOperation[];
  }): ToolPolicyHostContext {
    return {
      authority: {
        kind: 'mcp',
        serverId: args.server.id,
        toolName: args.toolName,
        ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      },
      transport: {
        kind: args.server.transport,
        network: args.server.transport === 'http' || args.server.transport === 'sse',
      },
      environment:
        args.environment
        ?? args.server.environment
        ?? McpPolicyContextService.deriveEnvironment(args.server),
      ...(args.operations ? { operations: args.operations } : {}),
    };
  }

  static deriveEnvironment(server: McpServerConfig): ToolPolicyEnvironment {
    if (server.transport === 'stdio') {
      return 'local';
    }

    const hostname = new URL(server.url).hostname.toLowerCase();
    return isLoopbackHostname(hostname) ? 'local' : 'unknown';
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}
