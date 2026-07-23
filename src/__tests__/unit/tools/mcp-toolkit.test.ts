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

function contextFixture(options: {
  hiddenMcpServerIds?: string[];
  includeGithub?: boolean;
} = {}) {
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
      ...(options.includeGithub ? {
        github: {
          command: 'npx',
          args: ['-y', 'github-mcp'],
          tools: {
            approval: 'never',
          },
        },
      } : {}),
    },
  }), 'utf8');
  new McpService({ workspaceRoot, stateRoot }).activateServer('notion');
  if (options.includeGithub) {
    new McpService({ workspaceRoot, stateRoot }).activateServer('github');
  }
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
      ...(options.includeGithub ? {
        github: {
          serverId: 'github',
          tools: [{
            name: 'list-issues',
            description: 'List GitHub issues.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { repo: { type: 'string' } },
              required: ['repo'],
            },
          }],
          refreshedAt: '2026-06-08T00:00:00.000Z',
        },
      } : {}),
    },
  });

  return {
    workspaceRoot,
    stateRoot,
    artifactRoot: join(stateRoot, 'artifacts'),
    model: 'gpt-5.5',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none' as const,
    hiddenMcpServerIds: options.hiddenMcpServerIds,
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

  it('resolves broker and cached-tool policy provenance from host configuration', () => {
    const tools = mcpToolkit.createTools(contextFixture());
    const callTool = tools.find((candidate) => candidate.name === 'mcp_call_tool');
    const cachedTool = tools.find((candidate) => candidate.name === 'mcp__notion__search_pages');

    expect(callTool?.resolveHostPolicy?.({
      serverId: 'notion',
      toolName: 'search-pages',
      arguments: { query: 'roadmap' },
    })).toEqual({
      authority: {
        kind: 'mcp',
        serverId: 'notion',
        toolName: 'search-pages',
      },
      transport: {
        kind: 'stdio',
        network: false,
      },
      environment: 'local',
    });
    expect(cachedTool?.hostPolicy).toEqual({
      authority: {
        kind: 'mcp',
        serverId: 'notion',
        toolName: 'search-pages',
      },
      transport: {
        kind: 'stdio',
        network: false,
      },
      environment: 'local',
    });
  });

  it('hides host-owned MCP servers from the default tool surface', async () => {
    const tools = mcpToolkit.createTools(contextFixture({
      includeGithub: true,
      hiddenMcpServerIds: ['notion'],
    }));
    const listTools = tools.find((candidate) => candidate.name === 'mcp_list_tools');
    const callTool = tools.find((candidate) => candidate.name === 'mcp_call_tool');

    expect(tools.map((tool) => tool.name)).toEqual([
      'mcp_list_tools',
      'mcp_call_tool',
      'mcp__github__list_issues',
    ]);
    await expect(listTools?.execute({})).resolves.toEqual({
      ok: true,
      output: {
        servers: [expect.objectContaining({
          id: 'github',
          tools: [expect.objectContaining({
            name: 'list-issues',
            heddleToolName: 'mcp__github__list_issues',
          })],
        })],
        issues: [],
      },
    });
    await expect(callTool?.execute({
      serverId: 'notion',
      toolName: 'search-pages',
      arguments: { query: 'roadmap' },
    })).resolves.toEqual({
      ok: false,
      error: 'MCP server is not available through default MCP tools: notion',
    });
  });

  it('removes the default MCP toolkit when every configured server is hidden', () => {
    expect(mcpToolkit.createTools(contextFixture({ hiddenMcpServerIds: ['notion'] }))).toEqual([]);
  });
});
