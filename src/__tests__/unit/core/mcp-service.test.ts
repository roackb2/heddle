import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileMcpCatalogRepository,
  FileMcpConfigRepository,
  McpService,
} from '@/core/mcp/index.js';

function workspaceFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-mcp-workspace-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  mkdirSync(stateRoot, { recursive: true });
  return { workspaceRoot, stateRoot };
}

describe('MCP service', () => {
  it('loads standard and VS Code-style server config into one overview', () => {
    const { workspaceRoot, stateRoot } = workspaceFixture();
    writeFileSync(FileMcpConfigRepository.resolvePath(stateRoot), JSON.stringify({
      mcpServers: {
        notion: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'notion-mcp'],
          env: {
            NOTION_TOKEN: '${env:NOTION_TOKEN}',
          },
        },
      },
      servers: {
        anytype: {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
    }), 'utf8');

    const overview = new McpService({ workspaceRoot, stateRoot }).listOverview();

    expect(overview.configPath).toBe(FileMcpConfigRepository.resolvePath(stateRoot));
    expect(overview.servers.map((server) => ({
      id: server.id,
      status: server.status,
      transport: server.config?.transport,
    }))).toEqual([
      { id: 'anytype', status: 'available', transport: 'http' },
      { id: 'notion', status: 'available', transport: 'stdio' },
    ]);
    expect(overview.issues).toEqual([]);
  });

  it('stores workspace enablement separately from server config', () => {
    const { workspaceRoot, stateRoot } = workspaceFixture();
    writeFileSync(FileMcpConfigRepository.resolvePath(stateRoot), JSON.stringify({
      mcpServers: {
        notion: {
          command: 'npx',
          args: ['-y', 'notion-mcp'],
        },
      },
    }), 'utf8');
    const service = new McpService({ workspaceRoot, stateRoot });

    expect(service.activateServer('notion')).toEqual(expect.objectContaining({
      ok: true,
      record: expect.objectContaining({ serverId: 'notion', status: 'enabled' }),
    }));
    expect(service.listOverview().servers[0]).toEqual(expect.objectContaining({
      id: 'notion',
      status: 'enabled',
    }));

    expect(service.disableServer('notion')).toEqual(expect.objectContaining({
      ok: true,
      record: expect.objectContaining({ serverId: 'notion', status: 'disabled' }),
    }));
    expect(service.listOverview().servers[0]).toEqual(expect.objectContaining({
      id: 'notion',
      status: 'disabled',
    }));
  });

  it('merges cached tool catalog into enabled server views', () => {
    const { workspaceRoot, stateRoot } = workspaceFixture();
    writeFileSync(FileMcpConfigRepository.resolvePath(stateRoot), JSON.stringify({
      mcpServers: {
        notion: {
          command: 'npx',
          args: ['-y', 'notion-mcp'],
        },
      },
    }), 'utf8');
    const service = new McpService({ workspaceRoot, stateRoot });
    service.activateServer('notion');
    new FileMcpCatalogRepository({ stateRoot }).write({
      version: 1,
      servers: {
        notion: {
          serverId: 'notion',
          serverName: 'Notion',
          tools: [{
            name: 'search_pages',
            description: 'Search Notion pages.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          }],
          refreshedAt: '2026-06-08T00:00:00.000Z',
        },
      },
    });

    expect(service.listOverview().servers[0]).toEqual(expect.objectContaining({
      id: 'notion',
      status: 'enabled',
      toolCount: 1,
      catalog: expect.objectContaining({
        serverName: 'Notion',
      }),
    }));
  });
});
