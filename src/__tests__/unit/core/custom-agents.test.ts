import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CustomAgentService } from '@/core/custom-agents/index.js';

describe('custom agents', () => {
  it('ships built-in agent options for code, ask, and review modes', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-builtins-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-home-'));
    const options = new CustomAgentService({ workspaceRoot, homeDir }).listOptions();

    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'builtin:ask', modeAlias: 'ask', source: 'built-in' }),
      expect.objectContaining({ id: 'builtin:code', modeAlias: 'code', source: 'built-in' }),
      expect.objectContaining({ id: 'builtin:review', modeAlias: 'review', source: 'built-in' }),
    ]));
  });

  it('resolves immutable turn snapshots for built-in ask mode', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-snapshot-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-home-'));
    const snapshot = new CustomAgentService({ workspaceRoot, homeDir })
      .resolveExecutionSnapshot('builtin:ask');

    expect(snapshot).toMatchObject({
      agentProfileId: 'builtin:ask',
      agentName: 'Ask',
      modeAlias: 'ask',
      source: 'built-in',
      runtime: { maxSteps: 60 },
      toolProfile: {
        preset: 'inspect',
        memoryMode: 'none',
      },
      approvalProfile: { preset: 'read_only' },
    });
    expect(snapshot?.definitionHash).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshot?.systemContextAppendix).toContain('You are running in ask mode.');
  });

  it('loads project definitions and lets project agents override user agents by id', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-project-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-user-'));
    writeAgent(homeDir, 'writer', [
      '---',
      'id: shared-writer',
      'name: User Writer',
      'description: User-defined writer.',
      'tools:',
      '  preset: inspect',
      'approval:',
      '  preset: read_only',
      '---',
      'Explain the repository without changing files.',
    ].join('\n'));
    writeAgent(workspaceRoot, 'writer', [
      '---',
      'id: shared-writer',
      'name: Project Writer',
      'description: Project-defined writer.',
      'modeAlias: ask',
      'runtime:',
      '  maxSteps: 12',
      'tools:',
      '  preset: inspect',
      '  includeTools:',
      '    - read_file',
      'approval:',
      '  preset: read_only',
      '---',
      'Use project-specific wording when explaining code.',
    ].join('\n'));

    const catalog = new CustomAgentService({ workspaceRoot, homeDir }).catalog();
    const shared = catalog.agents.find((agent) => agent.id === 'shared-writer');

    expect(shared).toMatchObject({
      id: 'shared-writer',
      name: 'Project Writer',
      source: 'project',
      modeAlias: 'ask',
      runtime: { maxSteps: 12 },
    });
    expect(catalog.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        source: 'project',
        message: 'Project custom agent "shared-writer" overrides the user custom agent with the same id.',
      }),
    ]));
  });

  it('rejects filesystem agents that try to reuse built-in ids', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-reserved-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-home-'));
    writeAgent(workspaceRoot, 'ask', [
      '---',
      'id: builtin:ask',
      'name: Shadow Ask',
      'description: Invalid shadow built-in.',
      '---',
      'This should not load.',
    ].join('\n'));

    const catalog = new CustomAgentService({ workspaceRoot, homeDir }).catalog();

    expect(catalog.agents.filter((agent) => agent.id === 'builtin:ask')).toHaveLength(1);
    expect(catalog.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        source: 'project',
        message: 'Custom agent id "builtin:ask" is reserved by a built-in agent.',
      }),
    ]));
  });
});

function writeAgent(root: string, directory: string, content: string): void {
  const agentDir = join(root, '.agents', 'agents', directory);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'AGENT.md'), `${content}\n`);
}
