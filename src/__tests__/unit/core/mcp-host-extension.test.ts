import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileMcpCatalogRepository,
  FileMcpConfigRepository,
  McpService,
} from '@/core/mcp/index.js';
import {
  ConversationEngineHostExtensionService,
  defineMcpHostExtension,
  prepareMcpHostExtension,
  prepareMcpHostExtensionCatalog,
} from '@/core/chat/engine/index.js';
import type { ToolToolkitContext } from '@/core/tools/index.js';

function contextFixture(): ToolToolkitContext {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-mcp-host-extension-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(FileMcpConfigRepository.resolvePath(stateRoot), JSON.stringify({
    mcpServers: {
      deck_service: {
        command: 'npm',
        args: ['run', 'mcp'],
        tools: {
          approval: 'always',
        },
      },
      notion: {
        command: 'npx',
        args: ['-y', 'notion-mcp'],
        tools: {
          approval: 'never',
        },
      },
    },
  }), 'utf8');

  const mcp = new McpService({ workspaceRoot, stateRoot });
  mcp.activateServer('deck_service');
  mcp.activateServer('notion');
  new FileMcpCatalogRepository({ stateRoot }).write({
    version: 1,
    servers: {
      deck_service: {
        serverId: 'deck_service',
        tools: [
          {
            name: 'create-deck',
            title: 'Create deck',
            description: 'Create a presentation deck.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
              },
              required: ['title'],
            },
          },
          {
            name: 'validate-deck',
            description: 'Validate a presentation deck.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string' },
              },
              required: ['source'],
            },
          },
        ],
        refreshedAt: '2026-07-01T00:00:00.000Z',
      },
      notion: {
        serverId: 'notion',
        tools: [{
          name: 'search-pages',
          description: 'Search Notion pages.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        }],
        refreshedAt: '2026-07-01T00:00:00.000Z',
      },
    },
  });

  return {
    workspaceRoot,
    stateRoot,
    artifactRoot: join(stateRoot, 'artifacts'),
    model: 'gpt-5.5',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none',
  };
}

describe('defineMcpHostExtension', () => {
  it('creates host tools from cached MCP descriptors without manual schema mapping', () => {
    const context = contextFixture();
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
      includeTools: ['create-deck'],
      defaultCapabilities: ['workspace.write'],
      systemContext: 'Use slide tools for presentation work.',
      artifacts: {
        enabled: true,
      },
    });

    const tools = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];

    expect(extension).toEqual(expect.objectContaining({
      id: 'slides',
      systemContext: 'Use slide tools for presentation work.',
      artifacts: { enabled: true },
    }));
    expect(extension.toolkits?.map((toolkit) => toolkit.id)).toEqual(['mcp.slides']);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual(expect.objectContaining({
      name: 'create_deck',
      description: 'Create a presentation deck.',
      requiresApproval: true,
      capabilities: ['workspace.write'],
      parameters: expect.objectContaining({
        properties: {
          title: { type: 'string' },
        },
        required: ['title'],
      }),
    }));
  });

  it('supports multiple MCP host extensions without tool name conflicts', () => {
    const context = contextFixture();
    const extensions = [
      defineMcpHostExtension({
        id: 'slides',
        serverId: 'deck_service',
        includeTools: ['create-deck'],
        toolNamePrefix: 'slides',
      }),
      defineMcpHostExtension({
        id: 'docs',
        serverId: 'notion',
        includeTools: ['search-pages'],
        toolNamePrefix: 'docs',
      }),
    ];
    const bundle = ConversationEngineHostExtensionService.compose(extensions);
    const tools = bundle?.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];

    expect(bundle?.toolkits?.map((toolkit) => toolkit.id)).toEqual(['mcp.slides', 'mcp.docs']);
    expect(tools.map((tool) => tool.name)).toEqual([
      'slides__create_deck',
      'docs__search_pages',
    ]);
    expect(tools.find((tool) => tool.name === 'docs__search_pages')?.requiresApproval).toBe(false);
  });

  it('allows host-specific names, descriptions, capabilities, and approval policy overrides', () => {
    const context = contextFixture();
    const extension = defineMcpHostExtension({
      id: 'presentation',
      serverId: 'deck_service',
      excludeTools: ['validate-deck'],
      toolOverrides: {
        'create-deck': {
          name: 'presentation_create_deck',
          description: 'Create a deck using the host presentation workspace.',
          capabilities: ['workspace.write'],
          requiresApproval: false,
        },
      },
    });

    const tools = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];

    expect(tools.map((tool) => tool.name)).toEqual(['presentation_create_deck']);
    expect(tools[0]).toEqual(expect.objectContaining({
      description: 'Create a deck using the host presentation workspace.',
      capabilities: ['workspace.write'],
      requiresApproval: false,
    }));
  });

  it('returns no tools until the MCP server is enabled and refreshed', () => {
    const context = contextFixture();
    const extension = defineMcpHostExtension({
      id: 'missing',
      serverId: 'linear',
    });

    expect(extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context))).toEqual([]);
  });

  it('reports MCP catalog preparation failures with the failing setup step', async () => {
    const context = contextFixture();

    const result = await prepareMcpHostExtensionCatalog({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
      serverId: 'broken',
      server: {
        type: 'stdio',
        command: 'node',
        args: ['-e', 'process.exit(1)'],
      },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      serverId: 'broken',
      step: 'refresh_catalog',
    }));
    expect(new FileMcpConfigRepository({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
    }).read().servers.map((server) => server.id).sort()).toEqual([
      'broken',
      'deck_service',
      'notion',
    ]);
  });

  it('prepares MCP host extension failures with the same setup contract', async () => {
    const context = contextFixture();

    const result = await prepareMcpHostExtension({
      id: 'broken-extension',
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
      serverId: 'broken',
      server: {
        type: 'stdio',
        command: 'node',
        args: ['-e', 'process.exit(1)'],
      },
      includeTools: ['search-pages'],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      serverId: 'broken',
      step: 'refresh_catalog',
    }));
  });
});
