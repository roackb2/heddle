import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactService } from '@/core/artifacts/index.js';
import {
  FileMcpCatalogRepository,
  FileMcpConfigRepository,
  McpClientService,
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
    sessionId: 'session-123',
    model: 'gpt-5.5',
    memoryDir: join(stateRoot, 'memory'),
    memoryMode: 'none',
  };
}

describe('defineMcpHostExtension', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('exposes all enabled catalog tools when includeTools is omitted', () => {
    const context = contextFixture();
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
    });

    const tools = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];

    expect(tools.map((tool) => tool.name)).toEqual(['create_deck', 'validate_deck']);
  });

  it('resolves and executes tools from embedded MCP data without reading stateRoot', async () => {
    // An empty stateRoot: no mcp.json, no catalog. The stateRoot-reading path
    // would find nothing here — so any resolved tool proves the embedded path.
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-mcp-embedded-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    mkdirSync(stateRoot, { recursive: true });
    const context: ToolToolkitContext = {
      workspaceRoot,
      stateRoot,
      artifactRoot: join(stateRoot, 'artifacts'),
      sessionId: 'session-embedded',
      model: 'gpt-5.5',
      memoryDir: join(stateRoot, 'memory'),
      memoryMode: 'none',
    };

    const resolved = {
      server: {
        id: 'deck_service',
        transport: 'stdio' as const,
        source: 'heddle' as const,
        command: 'npm',
        args: ['run', 'mcp'],
        env: {},
        tools: { deny: ['validate-deck'], approval: 'always' as const },
      },
      catalog: {
        serverId: 'deck_service',
        tools: [
          {
            name: 'create-deck',
            description: 'Create a presentation deck.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
          },
          {
            name: 'validate-deck',
            description: 'Validate a presentation deck.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        refreshedAt: '2026-07-09T00:00:00.000Z',
      },
    };

    const extension = defineMcpHostExtension({ id: 'slides', serverId: 'deck_service' }, resolved);
    const tools = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];

    // Resolved from embedded catalog (empty stateRoot), and deny policy honored.
    expect(tools.map((tool) => tool.name)).toEqual(['create_deck']);

    const clientCall = vi.spyOn(McpClientService.prototype, 'callTool')
      .mockResolvedValue({ ok: true, output: { done: true } });
    const stateCall = vi.spyOn(McpService.prototype, 'callTool');

    const result = await tools[0]?.execute({ title: 'Quarterly plan' });

    expect(result?.ok).toBe(true);
    // Execution went straight to the embedded server config via the client,
    // never through the stateRoot-backed McpService.
    expect(clientCall).toHaveBeenCalledWith(resolved.server, 'create-deck', { title: 'Quarterly plan' });
    expect(stateCall).not.toHaveBeenCalled();
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

  it('can hide the source MCP server from the default MCP surface', () => {
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
      includeTools: ['create-deck'],
      hideDefaultMcpTools: true,
    });
    const bundle = ConversationEngineHostExtensionService.compose([extension]);

    expect(extension.mcp).toEqual({ hideDefaultServers: ['deck_service'] });
    expect(bundle?.mcp).toEqual({ hideDefaultServers: ['deck_service'] });
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

  it('stores configured MCP result fields as artifacts and returns compact references', async () => {
    const context = contextFixture();
    const html = `<!doctype html><html><body>${'x'.repeat(64)}</body></html>`;
    vi.spyOn(McpService.prototype, 'callTool').mockResolvedValue({
      ok: true,
      output: {
        html,
        content: [{
          type: 'text',
          text: html,
        }],
        diagnostics: {
          valid: true,
        },
      },
    });
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
      includeTools: ['create-deck'],
      resultArtifacts: [{
        toolName: 'create-deck',
        path: 'html',
        replacePaths: ['content.0.text'],
        kind: 'html',
        domain: 'preview',
        title: 'preview.html',
        extension: 'html',
        mimeType: 'text/html',
        metadata: {
          source: 'unit-test',
        },
        maxPreviewChars: 16,
      }],
    });
    const [tool] = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];
    if (!tool) {
      throw new Error('Expected create-deck host tool');
    }

    const result = await tool.execute({ title: 'Quarterly plan' });
    const output = result.output as {
      html: {
        artifact: {
          id: string;
          path: string;
          relativePath: string;
          metadata: Record<string, unknown>;
        };
        contentPath: string[];
        preview: string;
        omittedCharacters: number;
      };
      content: Array<{
        text: unknown;
        type: string;
      }>;
      diagnostics: {
        valid: boolean;
      };
    };

    expect(result.ok).toBe(true);
    expect(McpService.prototype.callTool).toHaveBeenCalledWith('deck_service', 'create-deck', {
      title: 'Quarterly plan',
    });
    expect(output.diagnostics).toEqual({ valid: true });
    expect(output.html).toEqual(expect.objectContaining({
      contentPath: ['html'],
      preview: html.slice(0, 16),
      omittedCharacters: html.length - 16,
    }));
    expect(output.content[0]?.text).toEqual(output.html);
    expect(output.html.artifact).toEqual(expect.objectContaining({
      kind: 'html',
      domain: 'preview',
      title: 'preview.html',
      mimeType: 'text/html',
      sessionId: 'session-123',
      sourceTool: 'create_deck',
      relativePath: expect.stringMatching(/^files\/artifact-/),
      metadata: {
        source: 'unit-test',
        mcpServerId: 'deck_service',
        mcpToolName: 'create-deck',
        resultPath: ['html'],
      },
    }));
    expect(readFileSync(output.html.artifact.path, 'utf8')).toBe(html);
    expect(new ArtifactService({ artifactRoot: context.artifactRoot }).list({ sessionId: 'session-123' }))
      .toHaveLength(1);
    expect(new ArtifactService({ artifactRoot: context.artifactRoot }).current('session-123')?.id)
      .toBe(output.html.artifact.id);
  });

  it('auto-stores large duplicate MCP result strings as a single artifact', async () => {
    const context = contextFixture();
    const html = `<!doctype html><html><body>${'x'.repeat(64)}</body></html>`;
    vi.spyOn(McpService.prototype, 'callTool').mockResolvedValue({
      ok: true,
      output: {
        content: [{
          type: 'text',
          text: html,
        }],
        structuredContent: {
          result: {
            html,
            status: 'ok',
          },
        },
      },
    });
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
      includeTools: ['create-deck'],
      resultArtifacts: {
        auto: {
          minChars: 16,
          domain: 'preview',
          maxPreviewChars: 12,
          hints: [{
            pathIncludes: 'html',
            kind: 'html',
            title: 'preview.html',
            extension: 'html',
            mimeType: 'text/html',
            metadata: {
              source: 'auto-test',
            },
          }],
        },
      },
    });
    const [tool] = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];
    if (!tool) {
      throw new Error('Expected create-deck host tool');
    }

    const result = await tool.execute({ title: 'Quarterly plan' });
    const output = result.output as {
      structuredContent: {
        result: {
          html: {
            artifact: {
              id: string;
              path: string;
              metadata: Record<string, unknown>;
            };
            contentPath: string[];
            preview: string;
            omittedCharacters: number;
          };
          status: string;
        };
      };
      content: Array<{
        text: {
          artifact: {
            id: string;
          };
        };
        type: string;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(output.structuredContent.result.status).toBe('ok');
    expect(output.structuredContent.result.html).toEqual(expect.objectContaining({
      contentPath: ['structuredContent', 'result', 'html'],
      preview: html.slice(0, 12),
      omittedCharacters: html.length - 12,
    }));
    expect(output.content[0]?.text.artifact.id).toBe(output.structuredContent.result.html.artifact.id);
    expect(output.structuredContent.result.html.artifact).toEqual(expect.objectContaining({
      kind: 'html',
      domain: 'preview',
      title: 'preview.html',
      mimeType: 'text/html',
      sessionId: 'session-123',
      sourceTool: 'create_deck',
      metadata: {
        source: 'auto-test',
        mcpServerId: 'deck_service',
        mcpToolName: 'create-deck',
        resultPath: ['structuredContent', 'result', 'html'],
        autoCaptured: true,
      },
    }));
    expect(readFileSync(output.structuredContent.result.html.artifact.path, 'utf8')).toBe(html);
    expect(new ArtifactService({ artifactRoot: context.artifactRoot }).list({ sessionId: 'session-123' }))
      .toHaveLength(1);
  });

  it('compacts serialized structured content mirrors without saving duplicate artifacts', async () => {
    const context = contextFixture();
    const html = `<!doctype html><html><body>${'x'.repeat(64)}</body></html>`;
    vi.spyOn(McpService.prototype, 'callTool').mockResolvedValue({
      ok: true,
      output: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            html,
            summary: 'Exported preview.',
          }, null, 2),
        }],
        structuredContent: {
          result: {
            html,
            summary: 'Exported preview.',
          },
        },
      },
    });
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
      includeTools: ['create-deck'],
      resultArtifacts: {
        auto: {
          minChars: 64,
          domain: 'preview',
          hints: [{
            pathIncludes: 'html',
            kind: 'html',
            title: 'preview.html',
            extension: 'html',
            mimeType: 'text/html',
          }],
        },
      },
    });
    const [tool] = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];
    if (!tool) {
      throw new Error('Expected create-deck host tool');
    }

    const result = await tool.execute({ title: 'Quarterly plan' });
    const output = result.output as {
      structuredContent: {
        result: {
          html: {
            artifact: {
              id: string;
              path: string;
            };
            contentPath: string[];
          };
          summary: string;
        };
      };
      content: Array<{
        text: {
          html: {
            artifact: {
              id: string;
            };
          };
          summary: string;
        };
        type: string;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(output.structuredContent.result.html).toEqual(expect.objectContaining({
      contentPath: ['structuredContent', 'result', 'html'],
    }));
    expect(output.content[0]?.text).toEqual({
      html: output.structuredContent.result.html,
      summary: 'Exported preview.',
    });
    expect(output.content[0]?.text.html.artifact.id).toBe(output.structuredContent.result.html.artifact.id);
    expect(readFileSync(output.structuredContent.result.html.artifact.path, 'utf8')).toBe(html);
    expect(new ArtifactService({ artifactRoot: context.artifactRoot }).list({ sessionId: 'session-123' }))
      .toHaveLength(1);
  });

  it('auto-stores common large outputs with resultArtifacts true and no path hints', async () => {
    const context = contextFixture();
    const html = `<!doctype html><html><body>${'x'.repeat(1_400)}</body></html>`;
    vi.spyOn(McpService.prototype, 'callTool').mockResolvedValue({
      ok: true,
      output: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            html,
            summary: 'Exported preview.',
          }, null, 2),
        }],
        structuredContent: {
          result: {
            html,
            summary: 'Exported preview.',
          },
        },
      },
    });
    const extension = defineMcpHostExtension({
      id: 'slides',
      serverId: 'deck_service',
      includeTools: ['create-deck'],
      resultArtifacts: true,
    });
    const [tool] = extension.toolkits?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];
    if (!tool) {
      throw new Error('Expected create-deck host tool');
    }

    const result = await tool.execute({ title: 'Quarterly plan' });
    const output = result.output as {
      structuredContent: {
        result: {
          html: {
            artifact: {
              id: string;
              kind: string;
              mimeType?: string;
              path: string;
              title?: string;
            };
            contentPath: string[];
          };
          summary: string;
        };
      };
      content: Array<{
        text: {
          html: {
            artifact: {
              id: string;
            };
          };
          summary: string;
        };
        type: string;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(output.structuredContent.result.html).toEqual(expect.objectContaining({
      contentPath: ['structuredContent', 'result', 'html'],
    }));
    expect(output.structuredContent.result.html.artifact).toEqual(expect.objectContaining({
      kind: 'html',
      mimeType: 'text/html',
      title: 'create_deck-html.html',
    }));
    expect(output.content[0]?.text.html.artifact.id).toBe(output.structuredContent.result.html.artifact.id);
    expect(readFileSync(output.structuredContent.result.html.artifact.path, 'utf8')).toBe(html);
    expect(new ArtifactService({ artifactRoot: context.artifactRoot }).list({ sessionId: 'session-123' }))
      .toHaveLength(1);
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
