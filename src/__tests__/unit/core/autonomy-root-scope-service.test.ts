import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AutonomyRootScopeService } from '@/core/approvals/index.js';

describe('AutonomyRootScopeService', () => {
  it('finds sibling project roots without climbing above the active workspace family', () => {
    const familyRoot = mkdtempSync(join(tmpdir(), 'heddle-root-scope-family-'));
    const workspaceRoot = join(familyRoot, 'heddle');
    const siblingRoot = join(familyRoot, 'heddle-workspace-notes');
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
    mkdirSync(join(siblingRoot, '.git'), { recursive: true });

    expect(AutonomyRootScopeService.findProjectRoot({
      workspaceRoot,
      target: join(siblingRoot, 'task-plans', 'feature.md'),
    })).toBe(siblingRoot);
  });

  it('does not inspect unrelated roots outside the active workspace parent', () => {
    const familyRoot = mkdtempSync(join(tmpdir(), 'heddle-root-scope-family-'));
    const workspaceRoot = join(familyRoot, 'heddle');
    const unrelatedRoot = mkdtempSync(join(tmpdir(), 'heddle-root-scope-unrelated-'));
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
    mkdirSync(join(unrelatedRoot, '.git'), { recursive: true });

    expect(AutonomyRootScopeService.findProjectRoot({
      workspaceRoot,
      target: join(unrelatedRoot, 'README.md'),
    })).toBeUndefined();
  });

  it('does not promote the workspace parent even when it has project markers', () => {
    const familyRoot = mkdtempSync(join(tmpdir(), 'heddle-root-scope-family-'));
    const workspaceRoot = join(familyRoot, 'heddle');
    const looseFolder = join(familyRoot, 'loose-folder');
    mkdirSync(join(workspaceRoot, '.git'), { recursive: true });
    mkdirSync(looseFolder, { recursive: true });
    writeFileSync(join(familyRoot, 'package.json'), '{}\n');

    expect(AutonomyRootScopeService.findProjectRoot({
      workspaceRoot,
      target: join(looseFolder, 'README.md'),
    })).toBeUndefined();
  });
});
