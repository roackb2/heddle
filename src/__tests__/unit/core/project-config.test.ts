import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectConfigService } from '../../../core/project-config/index.js';

describe('ProjectConfigService', () => {
  it('initializes the default heddle config template', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-project-config-'));

    const result = ProjectConfigService.initialize(workspaceRoot);

    expect(result.created).toBe(true);
    expect(result.configPath).toBe(join(workspaceRoot, 'heddle.config.json'));
    expect(existsSync(result.configPath)).toBe(true);
    expect(JSON.parse(readFileSync(result.configPath, 'utf8'))).toEqual({
      model: 'gpt-5.4',
      maxSteps: 100,
      stateDir: '.heddle',
      directShellApproval: 'never',
      searchIgnoreDirs: ['.git', 'dist', 'node_modules', '.heddle'],
    });
  });

  it('does not overwrite an existing heddle config', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-project-config-'));
    const configPath = join(workspaceRoot, 'heddle.config.json');
    writeFileSync(configPath, `${JSON.stringify({ model: 'custom-model' })}\n`);

    const result = ProjectConfigService.initialize(workspaceRoot);

    expect(result.created).toBe(false);
    expect(result.config).toEqual({ model: 'custom-model' });
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ model: 'custom-model' });
  });

  it('reads supported fields and ignores unsupported or invalid config fields', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-project-config-'));
    writeFileSync(join(workspaceRoot, 'heddle.config.json'), `${JSON.stringify({
      model: 'gpt-5.4',
      maxSteps: -1,
      stateDir: '.state',
      directShellApproval: 'sometimes',
      searchIgnoreDirs: ['node_modules'],
      agentContextPaths: ['AGENTS.md'],
      unknown: true,
    })}\n`);

    expect(ProjectConfigService.read(workspaceRoot)).toEqual({
      model: 'gpt-5.4',
      stateDir: '.state',
      searchIgnoreDirs: ['node_modules'],
      agentContextPaths: ['AGENTS.md'],
    });
  });

  it('returns an empty config when the file is missing or invalid', () => {
    const missingWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-project-config-'));
    const invalidWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-project-config-'));
    writeFileSync(join(invalidWorkspaceRoot, 'heddle.config.json'), '{');

    expect(ProjectConfigService.read(missingWorkspaceRoot)).toEqual({});
    expect(ProjectConfigService.read(invalidWorkspaceRoot)).toEqual({});
  });
});
