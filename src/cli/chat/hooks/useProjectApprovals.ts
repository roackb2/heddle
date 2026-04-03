import { useEffect, useMemo, useState } from 'react';
import type { ToolCall } from '../../../index.js';
import {
  createProjectApprovalRule,
  findMatchingApprovalRule,
  loadProjectApprovalRules,
  saveProjectApprovalRules,
  type ProjectApprovalRule,
} from '../state/approval-rules.js';
import { extractShellCommand } from '../utils/format.js';

export function useProjectApprovals(approvalsFile: string) {
  const [rules, setRules] = useState<ProjectApprovalRule[]>(() => loadProjectApprovalRules(approvalsFile));

  useEffect(() => {
    saveProjectApprovalRules(approvalsFile, rules);
  }, [approvalsFile, rules]);

  const ruleMap = useMemo(
    () => new Set(rules.map((rule) => `${rule.tool}:${rule.command}`)),
    [rules],
  );

  const isApproved = (call: ToolCall): boolean => {
    const command = extractShellCommand(call.input);
    return Boolean(findMatchingApprovalRule(rules, call.tool, command));
  };

  const rememberApproval = (call: ToolCall) => {
    const command = extractShellCommand(call.input);
    if (call.tool !== 'run_shell_mutate' || !command) {
      return;
    }

    const rule = createProjectApprovalRule(command);
    const key = `${rule.tool}:${rule.command}`;
    if (ruleMap.has(key)) {
      return;
    }

    setRules((current) => [...current, rule]);
  };

  return {
    rules,
    isApproved,
    rememberApproval,
  };
}
