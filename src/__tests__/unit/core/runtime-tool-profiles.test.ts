import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RuntimeToolProfileService, RuntimeToolService } from '@/core/runtime/tools/index.js';
import type { ToolDefinition } from '@/core/types.js';

describe('runtime tool profiles', () => {
  it('filters inspect profiles to read-only workspace and shell inspection tools', () => {
    const filtered = RuntimeToolProfileService.apply({
      tools: [
        tool('read_file'),
        tool('edit_file'),
        tool('run_shell_inspect'),
        tool('run_shell_mutate'),
        tool('mcp__external_mutation'),
        tool('update_plan'),
      ],
      profile: {
        preset: 'inspect',
        includeTools: ['edit_file', 'mcp__external_mutation'],
      },
    });

    expect(filtered.map((candidate) => candidate.name)).toEqual([
      'read_file',
      'run_shell_inspect',
    ]);
  });

  it('applies inspect profiles to the default runtime tool bundle', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-tool-profile-'));
    const tools = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-5.4',
      workspaceRoot,
      stateRoot: join(workspaceRoot, '.heddle'),
      apiKey: 'explicit-key',
      toolProfile: {
        preset: 'inspect',
        includeTools: [
          'project_dashboard',
          'list_files',
          'read_file',
          'search_files',
          'run_shell_inspect',
          'read_agent_skill',
        ],
        memoryMode: 'none',
      },
    });
    const toolNames = tools.map((candidate) => candidate.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      'project_dashboard',
      'list_files',
      'read_file',
      'search_files',
      'run_shell_inspect',
      'read_agent_skill',
    ]));
    expect(toolNames).not.toEqual(expect.arrayContaining([
      'edit_file',
      'delete_file',
      'move_file',
      'run_shell_mutate',
      'memory_checkpoint',
      'record_knowledge',
      'mcp_call_tool',
    ]));
  });

  it('adds host-provided tools before applying runtime tool profiles', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-host-tool-profile-'));
    const tools = RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-5.4',
      workspaceRoot,
      stateRoot: join(workspaceRoot, '.heddle'),
      apiKey: 'explicit-key',
      tools: [
        {
          ...tool('slidex_create_deck'),
          capabilities: ['workspace.write'],
        },
        {
          ...tool('slidex_read_templates'),
          capabilities: ['workspace.read'],
        },
      ],
      toolProfile: {
        preset: 'custom',
        allowedCapabilities: ['workspace.read'],
      },
    });

    expect(tools.map((candidate) => candidate.name)).toEqual(expect.arrayContaining([
      'project_dashboard',
      'list_files',
      'read_file',
      'search_files',
      'read_agent_skill',
      'slidex_read_templates',
    ]));
    expect(tools.map((candidate) => candidate.name)).not.toContain('slidex_create_deck');
  });

  it('rejects duplicate host-provided runtime tool names', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-host-tool-duplicate-'));

    expect(() => RuntimeToolService.createDefaultAgentTools({
      model: 'gpt-5.4',
      workspaceRoot,
      stateRoot: join(workspaceRoot, '.heddle'),
      apiKey: 'explicit-key',
      tools: [tool('read_file')],
    })).toThrow('Duplicate runtime tool name: read_file');
  });
});

function tool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: {},
    execute: async () => ({ ok: true }),
  };
}
