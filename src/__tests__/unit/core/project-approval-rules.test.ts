import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileProjectApprovalRuleRepository, ProjectApprovalRules, type ProjectApprovalRule } from '@/core/approvals/remembered-rules/index.js';

describe('project approval rules', () => {
  it('normalizes repeated whitespace and canonicalizes common verification command aliases', () => {
    expect(ProjectApprovalRules.normalizeCommand('  yarn   test   --watch  ')).toBe('yarn test --watch');
    expect(ProjectApprovalRules.normalizeCommand('npx tsc --noEmit')).toBe('tsc --noEmit');
    expect(ProjectApprovalRules.normalizeCommand('./node_modules/.bin/tsc --noEmit')).toBe('tsc --noEmit');
    expect(ProjectApprovalRules.normalizeCommand('node_modules/.bin/vitest run src/__tests__/tools.test.ts')).toBe(
      'vitest run src/__tests__/tools.test.ts',
    );
  });

  it('saves and reloads project approval rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-'));
    const filePath = join(root, 'command-approvals.json');
    const rule = ProjectApprovalRules.createForCommand('yarn test');

    new FileProjectApprovalRuleRepository(filePath).save([rule]);

    expect(new FileProjectApprovalRuleRepository(filePath).list()).toEqual([rule]);
  });

  it('matches exact normalized mutate commands only', () => {
    const rules = [ProjectApprovalRules.createForCommand('gh pr view 123')];

    expect(ProjectApprovalRules.findMatching({
      rules,
      tool: 'run_shell_mutate',
      input: { command: 'gh pr view 123' },
    })).toBeDefined();
    expect(ProjectApprovalRules.findMatching({
      rules,
      tool: 'run_shell_mutate',
      input: { command: 'gh pr view 124' },
    })).toBeUndefined();
    expect(ProjectApprovalRules.findMatching({
      rules,
      tool: 'run_shell_inspect',
      input: { command: 'yarn test' },
    })).toBeUndefined();
  });

  it('broadens low-risk workspace verification approvals to a command-family prefix', () => {
    const rule = ProjectApprovalRules.createForCommand('yarn test src/__tests__/tools.test.ts');

    expect(rule.mode).toBe('prefix');
    expect(rule.command).toBe('yarn test');
    expect(rule.scope).toBe('workspace');
    expect(rule.capability).toBe('verification');
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: 'yarn test' },
    })).toBeDefined();
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: 'yarn test src/__tests__/run-agent.test.ts' },
    })).toBeDefined();
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: 'yarn build' },
    })).toBeUndefined();
  });

  it('broadens canonicalized tsc verification approvals to a reusable family rule', () => {
    const rule = ProjectApprovalRules.createForCommand('npx tsc --noEmit');

    expect(rule.mode).toBe('prefix');
    expect(rule.command).toBe('tsc');
    expect(rule.capability).toBe('verification');
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: 'tsc -p tsconfig.build.json --noEmit' },
    })).toBeDefined();
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: './node_modules/.bin/tsc --pretty false' },
    })).toBeDefined();
  });

  it('broadens canonicalized vitest verification approvals to a reusable family rule', () => {
    const rule = ProjectApprovalRules.createForCommand('./node_modules/.bin/vitest run src/__tests__/tools.test.ts');

    expect(rule.mode).toBe('prefix');
    expect(rule.command).toBe('vitest run');
    expect(rule.capability).toBe('verification');
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: 'vitest run src/__tests__/run-agent.test.ts' },
    })).toBeDefined();
    expect(ProjectApprovalRules.findMatching({
      rules: [rule],
      tool: 'run_shell_mutate',
      input: { command: 'node_modules/.bin/vitest run src/__tests__/chat-format.test.ts' },
    })).toBeDefined();
  });

  it('creates a project-wide edit_file approval rule from a tool call', () => {
    const rule = ProjectApprovalRules.createForCall({
      id: 'tool-1',
      tool: 'edit_file',
      input: { path: 'src/example.ts', oldText: 'a', newText: 'b' },
    });

    expect(rule).toMatchObject({
      tool: 'edit_file',
      mode: 'tool',
      command: '*',
      scope: 'workspace',
      capability: 'file_edit',
    });
    expect(ProjectApprovalRules.findMatching({
      rules: [rule!],
      tool: 'edit_file',
      input: { path: 'src/another.ts', content: 'x', createIfMissing: true },
    })).toBeDefined();
  });

  it('creates exact remembered approvals for outside-workspace read_file and list_files calls', () => {
    const readRule = ProjectApprovalRules.createForCall({
      id: 'tool-1',
      tool: 'read_file',
      input: { path: '../notes/summary.md' },
    });
    const listRule = ProjectApprovalRules.createForCall({
      id: 'tool-2',
      tool: 'list_files',
      input: { path: '../notes/' },
    });

    expect(readRule).toMatchObject({
      tool: 'read_file',
      mode: 'exact',
      command: '../notes/summary.md',
      scope: 'outside_workspace',
      capability: 'file_inspection',
    });
    expect(listRule).toMatchObject({
      tool: 'list_files',
      mode: 'exact',
      command: '../notes',
      scope: 'outside_workspace',
      capability: 'file_inspection',
    });
    expect(ProjectApprovalRules.findMatching({
      rules: [readRule!],
      tool: 'read_file',
      input: { path: '../notes/summary.md' },
    })).toBeDefined();
    expect(ProjectApprovalRules.findMatching({
      rules: [readRule!],
      tool: 'read_file',
      input: { path: '../notes/other.md' },
    })).toBeUndefined();
    expect(ProjectApprovalRules.findMatching({
      rules: [listRule!],
      tool: 'list_files',
      input: { path: '../notes' },
    })).toBeDefined();
  });

  it('loads remembered outside-workspace file inspection approvals from disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-files-'));
    const filePath = join(root, 'command-approvals.json');
    const createdAt = new Date().toISOString();

    writeFileSync(filePath, `${JSON.stringify([
      {
        tool: 'read_file',
        mode: 'exact',
        command: '../notes/summary.md',
        scope: 'outside_workspace',
        capability: 'file_inspection',
        createdAt,
      },
      {
        tool: 'list_files',
        mode: 'exact',
        command: '../notes/',
        scope: 'outside_workspace',
        capability: 'file_inspection',
        createdAt,
      },
    ], null, 2)}\n`);

    expect(new FileProjectApprovalRuleRepository(filePath).list()).toEqual([
      {
        tool: 'read_file',
        mode: 'exact',
        command: '../notes/summary.md',
        scope: 'outside_workspace',
        capability: 'file_inspection',
        createdAt,
      },
      {
        tool: 'list_files',
        mode: 'exact',
        command: '../notes',
        scope: 'outside_workspace',
        capability: 'file_inspection',
        createdAt,
      },
    ]);
  });

  it('loads legacy mutate approval rules from disk without dropping them', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-legacy-'));
    const filePath = join(root, 'command-approvals.json');

    new FileProjectApprovalRuleRepository(filePath).save([
      {
        tool: 'run_shell_mutate',
        mode: 'exact',
        command: 'ffmpeg -i input.mp4 output.gif',
        scope: 'workspace',
        capability: 'unknown_workspace',
        createdAt: new Date().toISOString(),
      },
    ]);

    const legacyFilePath = join(root, 'legacy-command-approvals.json');
    const legacyRules = [
      {
        tool: 'run_shell_mutate',
        command: 'yarn test',
        createdAt: new Date().toISOString(),
      },
    ];

    writeFileSync(legacyFilePath, `${JSON.stringify(legacyRules, null, 2)}\n`);

    const loaded = new FileProjectApprovalRuleRepository(legacyFilePath).list();
    expect(loaded[0]).toMatchObject({
      tool: 'run_shell_mutate',
      mode: 'prefix',
      command: 'yarn test',
    });
  });

  it('describes approval rules based on tool and mode', () => {
    const editRule: ProjectApprovalRule = {
      tool: 'edit_file',
      mode: 'tool',
      command: '*',
      scope: 'workspace',
      capability: 'file_edit',
      createdAt: new Date().toISOString(),
    };

    const readRule: ProjectApprovalRule = {
      tool: 'read_file',
      mode: 'exact',
      command: '../notes/summary.md',
      scope: 'outside_workspace',
      capability: 'file_inspection',
      createdAt: new Date().toISOString(),
    };

    const prefixRule: ProjectApprovalRule = {
      tool: 'run_shell_mutate',
      mode: 'prefix',
      command: 'yarn lint',
      scope: 'workspace',
      capability: 'verification',
      createdAt: new Date().toISOString(),
    };

    const exactRule: ProjectApprovalRule = {
      tool: 'run_shell_mutate',
      mode: 'exact',
      command: 'gh pr view 123',
      scope: 'workspace',
      capability: 'unknown_workspace',
      createdAt: new Date().toISOString(),
    };

    expect(ProjectApprovalRules.describe(editRule)).toContain('allow edit_file');
    expect(ProjectApprovalRules.describe(readRule)).toBe('allow read_file for this project');
    expect(ProjectApprovalRules.describe(prefixRule)).toContain('allow yarn lint command family for this project');
    expect(ProjectApprovalRules.describe(exactRule)).toBe('allow exact command');
  });

  it('normalizes run shell and edit file approvals', () => {
    expect(ProjectApprovalRules.extractTarget({ tool: 'run_shell_mutate', input: '  yarn   test  ' })).toBe('yarn test');
    expect(ProjectApprovalRules.extractTarget({ tool: 'run_shell_mutate', input: { command: ' yarn test src/ ' } })).toBe('yarn test src/');
    expect(ProjectApprovalRules.extractTarget({ tool: 'run_shell_mutate', input: { command: '' } })).toBeUndefined();
    expect(ProjectApprovalRules.extractTarget({ tool: 'run_shell_mutate', input: 42 })).toBeUndefined();

    expect(ProjectApprovalRules.extractTarget({ tool: 'edit_file', input: '.' })).toBe('.');
    expect(ProjectApprovalRules.extractTarget({ tool: 'edit_file', input: './' })).toBe('.');
    expect(ProjectApprovalRules.extractTarget({ tool: 'edit_file', input: './src/' })).toBe('./src');
    expect(ProjectApprovalRules.extractTarget({ tool: 'edit_file', input: { path: './foo/bar/' } })).toBe('./foo/bar');
    expect(ProjectApprovalRules.extractTarget({ tool: 'edit_file', input: { path: '' } })).toBeUndefined();
    expect(ProjectApprovalRules.extractTarget({ tool: 'read_file', input: { path: '../notes/summary.md' } })).toBe('../notes/summary.md');
    expect(ProjectApprovalRules.extractTarget({ tool: 'list_files', input: { path: '../notes/' } })).toBe('../notes');
  });

  it('falls back to unknown workspace rules when the shell command is blocked', () => {
    const rule = ProjectApprovalRules.createForCommand('yarn test; echo hi');

    expect(rule.mode).toBe('exact');
    expect(rule.scope).toBe('workspace');
    expect(rule.capability).toBe('unknown_workspace');
    expect(rule.command).toBe('yarn test; echo hi');
  });

  it('deduplicates duplicate rules when loading from disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-dedupe-'));
    const filePath = join(root, 'command-approvals.json');
    const rule = ProjectApprovalRules.createForCommand('yarn lint');
    const duplicate = { ...rule, createdAt: new Date().toISOString() };

    writeFileSync(filePath, `${JSON.stringify([rule, duplicate], null, 2)}\n`);

    const loaded = new FileProjectApprovalRuleRepository(filePath).list();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].command).toBe(rule.command);
  });
});
