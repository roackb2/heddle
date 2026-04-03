import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createProjectApprovalRule,
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
    const rules = [createProjectApprovalRule('yarn test')];

    expect(findMatchingApprovalRule(rules, 'run_shell_mutate', 'yarn   test')).toBeDefined();
    expect(findMatchingApprovalRule(rules, 'run_shell_mutate', 'yarn build')).toBeUndefined();
    expect(findMatchingApprovalRule(rules, 'run_shell_inspect', 'yarn test')).toBeUndefined();
  });
});
