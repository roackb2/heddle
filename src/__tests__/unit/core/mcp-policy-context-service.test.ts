import { describe, expect, it } from 'vitest';
import {
  McpPolicyContextService,
  type McpServerConfig,
} from '@/core/mcp/index.js';

function httpServer(args: {
  id?: string;
  url: string;
  environment?: 'local' | 'dev' | 'staging' | 'production' | 'unknown';
}): McpServerConfig {
  return {
    id: args.id ?? 'remote',
    transport: 'http',
    source: 'heddle',
    url: args.url,
    headers: {},
    ...(args.environment ? { environment: args.environment } : {}),
  };
}

describe('McpPolicyContextService', () => {
  it.each([
    {
      name: 'a local stdio process',
      server: {
        id: 'local_stdio',
        transport: 'stdio' as const,
        source: 'heddle' as const,
        command: 'node',
        args: ['server.js'],
        env: {},
      },
      environment: 'local',
      transport: { kind: 'stdio', network: false },
    },
    {
      name: 'a loopback HTTP endpoint',
      server: httpServer({ id: 'local_http', url: 'http://127.0.0.1:3010/mcp' }),
      environment: 'local',
      transport: { kind: 'http', network: true },
    },
    {
      name: 'an explicitly classified development endpoint',
      server: httpServer({
        id: 'development',
        url: 'https://mcp.dev.example.test',
        environment: 'dev',
      }),
      environment: 'dev',
      transport: { kind: 'http', network: true },
    },
    {
      name: 'an explicitly classified production endpoint',
      server: httpServer({
        id: 'production',
        url: 'https://mcp.example.test',
        environment: 'production',
      }),
      environment: 'production',
      transport: { kind: 'http', network: true },
    },
  ])('derives host-owned provenance for $name', ({ server, environment, transport }) => {
    expect(McpPolicyContextService.create({
      server,
      toolName: 'search',
    })).toEqual({
      authority: {
        kind: 'mcp',
        serverId: server.id,
        toolName: 'search',
      },
      transport,
      environment,
    });
  });

  it('uses an embedding host override and records tenant and effect ownership', () => {
    expect(McpPolicyContextService.create({
      server: httpServer({
        id: 'shared',
        url: 'https://mcp.example.test',
        environment: 'production',
      }),
      toolName: 'update-record',
      environment: 'staging',
      tenantId: 'tenant-42',
      operations: ['write'],
    })).toEqual({
      authority: {
        kind: 'mcp',
        serverId: 'shared',
        toolName: 'update-record',
        tenantId: 'tenant-42',
      },
      transport: {
        kind: 'http',
        network: true,
      },
      environment: 'staging',
      operations: ['write'],
    });
  });
});
