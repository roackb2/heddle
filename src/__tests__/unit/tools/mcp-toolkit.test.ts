import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileMcpCatalogRepository,
  FileMcpConfigRepository,
  McpService,
} from '@/core/mcp/index.js';
import { mcpToolkit } from '@/core/tools/toolkits/mcp/toolkit.js';

function contextFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-mcp-toolkit-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(FileMcpConfigRepository.resolvePath(stateRoot), JSON.stringify({
    mcpServers: {
      notion: {
        command: 'npx',
        args: ['-y', 'notion-mcp'],
        tools: {
          approval: 'always',
        },
      },
    },
  }), 'utf8');
  new McpService({ workspaceRoot, stateRoot }).activateServer('notion');
  new FileMcpCatalogRepository({ stateRoot }).write({
    version: 1,
    servers: {
      notion: {
        serverId: 'notion',
        tools: [{
          name: 'search-pages',
          description: 'Search Notion pages.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        }],
        refreshedAt: '2026-06-08T00:00:00.000Z',
      },
    },
  });

  return {
    workspaceRoot,
    stateRoot,
    model: 'gpt-5.5',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none' as const,
  };
}

describe('MCP toolkit', () => {
  it('exposes broker tools and cached per-server MCP tools', () => {
    const tools = mcpToolkit.createTools(contextFixture());

    expect(tools.map((tool) => tool.name)).toEqual([
      'mcp_list_tools',
      'mcp_call_tool',
      'mcp__notion__search_pages',
    ]);
    expect(tools.find((tool) => tool.name === 'mcp_call_tool')?.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.name === 'mcp__notion__search_pages')?.requiresApproval).toBe(true);
  });

  it('lists cached MCP tools without launching servers', async () => {
    const tool = mcpToolkit.createTools(contextFixture()).find((candidate) => candidate.name === 'mcp_list_tools');

    await expect(tool?.execute({})).resolves.toEqual({
      ok: true,
      output: {
        servers: [expect.objectContaining({
          id: 'notion',
          status: 'enabled',
          tools: [expect.objectContaining({
            name: 'search-pages',
            heddleToolName: 'mcp__notion__search_pages',
          })],
        })],
        issues: [],
      },
    });
  });

  it('keeps MCP arguments nested under arguments for policy-envelope compatibility', () => {
    const callTool = mcpToolkit.createTools(contextFixture()).find((candidate) => candidate.name === 'mcp_call_tool');

    expect(callTool?.parameters).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        arguments: expect.objectContaining({
          type: 'object',
        }),
      }),
      required: ['serverId', 'toolName', 'arguments'],
    }));
  });
});
