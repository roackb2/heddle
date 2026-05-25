import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ControlPlaneWorkspaceFilesController } from '@/server/controllers/trpc/control-plane/workspace-files.js';

describe('control-plane workspace file suggestions', () => {
  it('uses git ignore rules for file mention suggestions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-workspace-files-gitignore-'));
    const workspaceRoot = join(root, 'packages', 'app');
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
    mkdirSync(join(workspaceRoot, '.agents', 'skills'), { recursive: true });
    mkdirSync(join(workspaceRoot, '.heddle', 'traces'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), 'packages/app/.agents\n', 'utf8');
    writeFileSync(join(workspaceRoot, 'src', 'main.ts'), 'export const visible = true;\n', 'utf8');
    writeFileSync(join(workspaceRoot, '.agents', 'skills', 'SKILL.md'), '# Ignored skill\n', 'utf8');
    writeFileSync(join(workspaceRoot, '.heddle', 'traces', 'trace.json'), '{}\n', 'utf8');

    const suggestions = await ControlPlaneWorkspaceFilesController.searchFiles({
      workspaceRoot,
      query: '',
      limit: 20,
    });

    expect(suggestions.map((suggestion) => suggestion.path)).toContain('src/main.ts');
    expect(suggestions.map((suggestion) => suggestion.path)).not.toContain('.agents/skills/SKILL.md');
    expect(suggestions.map((suggestion) => suggestion.path)).not.toContain('.heddle/traces/trace.json');
  });
});
