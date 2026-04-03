import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { ProjectApprovalRule } from '../cli/chat/state/approval-rules.js';
import {
  createProjectApprovalRule,
  createProjectApprovalRuleForCall,
  describeProjectApprovalRule,
  extractApprovalTarget,
  findMatchingApprovalRule,
  loadProjectApprovalRules,
  normalizeApprovedCommand,
  saveProjectApprovalRules,
} from '../cli/chat/state/approval-rules.js';

describe('project approval rules', () => {
  it('normalizes repeated whitespace in saved commands', () => {
    expect(normalizeApprovedCommand('  yarn   test   --watch  ')).toBe('yarn test --watch');
  });

  it('saves and reloads project approval rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-'));
    const filePath = join(root, 'command-approvals.json');
    const rule = createProjectApprovalRule('yarn test');

    saveProjectApprovalRules(filePath, [rule]);

    expect(loadProjectApprovalRules(filePath)).toEqual([rule]);
  });

  it('matches exact normalized mutate commands only', () => {
    const rules = [createProjectApprovalRule('gh pr view 123')];

    expect(findMatchingApprovalRule(rules, 'run_shell_mutate', { command: 'gh pr view 123' })).toBeDefined();
    expect(findMatchingApprovalRule(rules, 'run_shell_mutate', { command: 'gh pr view 124' })).toBeUndefined();
    expect(findMatchingApprovalRule(rules, 'run_shell_inspect', { command: 'yarn test' })).toBeUndefined();
  });

  it('broadens low-risk workspace verification approvals to a command-family prefix', () => {
    const rule = createProjectApprovalRule('yarn test src/__tests__/tools.test.ts');

    expect(rule.mode).toBe('prefix');
    expect(rule.command).toBe('yarn test');
    expect(rule.scope).toBe('workspace');
    expect(rule.capability).toBe('verification');
    expect(findMatchingApprovalRule([rule], 'run_shell_mutate', { command: 'yarn test' })).toBeDefined();
    expect(findMatchingApprovalRule([rule], 'run_shell_mutate', { command: 'yarn test src/__tests__/run-agent.test.ts' })).toBeDefined();
    expect(findMatchingApprovalRule([rule], 'run_shell_mutate', { command: 'yarn build' })).toBeUndefined();
  });

  it('creates a project-wide edit_file approval rule from a tool call', () => {
    const rule = createProjectApprovalRuleForCall({
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
    expect(findMatchingApprovalRule([rule!], 'edit_file', { path: 'src/another.ts', content: 'x', createIfMissing: true })).toBeDefined();
  });

  it('loads legacy mutate approval rules from disk without dropping them', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-legacy-'));
    const filePath = join(root, 'command-approvals.json');

    saveProjectApprovalRules(filePath, [
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

    const loaded = loadProjectApprovalRules(legacyFilePath);
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

    expect(describeProjectApprovalRule(editRule)).toContain('allow edit_file');
    expect(describeProjectApprovalRule(prefixRule)).toContain('command family');
    expect(describeProjectApprovalRule(exactRule)).toContain('exact command');
  });

  it('normalizes run shell and edit file approvals', () => {
    expect(extractApprovalTarget('run_shell_mutate', '  yarn   test  ')).toBe('yarn test');
    expect(extractApprovalTarget('run_shell_mutate', { command: ' yarn test src/ ' })).toBe('yarn test src/');
    expect(extractApprovalTarget('run_shell_mutate', { command: '' })).toBeUndefined();
    expect(extractApprovalTarget('run_shell_mutate', 42)).toBeUndefined();

    expect(extractApprovalTarget('edit_file', '.')).toBe('.');
    expect(extractApprovalTarget('edit_file', './')).toBe('.');
    expect(extractApprovalTarget('edit_file', './src/')).toBe('./src');
    expect(extractApprovalTarget('edit_file', { path: './foo/bar/' })).toBe('./foo/bar');
    expect(extractApprovalTarget('edit_file', { path: '' })).toBeUndefined();
  });

  it('falls back to unknown workspace rules when the shell command is blocked', () => {
    const rule = createProjectApprovalRule('yarn test; echo hi');

    expect(rule.mode).toBe('exact');
    expect(rule.scope).toBe('workspace');
    expect(rule.capability).toBe('unknown_workspace');
    expect(rule.command).toBe('yarn test; echo hi');
  });

  it('deduplicates duplicate rules when loading from disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-approval-rules-dedupe-'));
    const filePath = join(root, 'command-approvals.json');
    const rule = createProjectApprovalRule('yarn lint');
    const duplicate = { ...rule, createdAt: new Date().toISOString() };

    writeFileSync(filePath, `${JSON.stringify([rule, duplicate], null, 2)}\n`);

    const loaded = loadProjectApprovalRules(filePath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].command).toBe(rule.command);
  });
});
