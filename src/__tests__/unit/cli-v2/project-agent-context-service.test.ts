import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliV2ProjectAgentContextService } from '@/cli-v2/services/project-agent-context-service.js';

describe('project agent context', () => {
  it('prefers HEDDLE.md when multiple default instruction files exist', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-agent-context-'));
    writeFileSync(join(workspaceRoot, 'HEDDLE.md'), 'Read Heddle instructions.\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), 'Read agent instructions.\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'CLAUDE.md'), 'Read Claude instructions.\n', 'utf8');

    expect(CliV2ProjectAgentContextService.resolvePaths(workspaceRoot, undefined)).toEqual(['HEDDLE.md']);
  });

  it('falls back to AGENTS.md and CLAUDE.md when higher-priority defaults are absent or empty', () => {
    const agentsWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-agent-context-agents-'));
    writeFileSync(join(agentsWorkspaceRoot, 'HEDDLE.md'), '\n', 'utf8');
    writeFileSync(join(agentsWorkspaceRoot, 'AGENTS.md'), 'Read agent instructions.\n', 'utf8');

    const claudeWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-agent-context-claude-'));
    writeFileSync(join(claudeWorkspaceRoot, 'CLAUDE.md'), 'Read Claude instructions.\n', 'utf8');

    expect(CliV2ProjectAgentContextService.resolvePaths(agentsWorkspaceRoot, undefined)).toEqual(['AGENTS.md']);
    expect(CliV2ProjectAgentContextService.resolvePaths(claudeWorkspaceRoot, undefined)).toEqual(['CLAUDE.md']);
  });

  it('respects configured paths exactly instead of applying defaults', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-agent-context-config-'));
    writeFileSync(join(workspaceRoot, 'HEDDLE.md'), 'Read Heddle instructions.\n', 'utf8');

    expect(CliV2ProjectAgentContextService.resolvePaths(workspaceRoot, ['CUSTOM.md', 'OTHER.md'])).toEqual(['CUSTOM.md', 'OTHER.md']);
  });

  it('loads readable configured project context files', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-agent-context-load-'));
    writeFileSync(join(workspaceRoot, 'HEDDLE.md'), 'Read docs/agent-context.md first.\n', 'utf8');

    const context = CliV2ProjectAgentContextService.load(workspaceRoot, ['HEDDLE.md', 'MISSING.md']);

    expect(context).toBe('Source: HEDDLE.md\nRead docs/agent-context.md first.');
  });
});
