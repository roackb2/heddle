import { useEffect, useRef, useState } from 'react';
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
  const rulesRef = useRef<ProjectApprovalRule[]>(rules);

  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);

  useEffect(() => {
    saveProjectApprovalRules(approvalsFile, rules);
  }, [approvalsFile, rules]);

  const isApproved = (call: ToolCall): boolean => {
    const command = extractShellCommand(call.input);
    return Boolean(findMatchingApprovalRule(rulesRef.current, call.tool, command));
  };

  const rememberApproval = (call: ToolCall) => {
    const command = extractShellCommand(call.input);
    if (call.tool !== 'run_shell_mutate' || !command) {
      return;
    }

    const rule = createProjectApprovalRule(command);
    if (findMatchingApprovalRule(rulesRef.current, rule.tool, rule.command)) {
      return;
    }

    const nextRules = [...rulesRef.current, rule];
    rulesRef.current = nextRules;
    setRules(nextRules);
  };

  return {
    rules,
    isApproved,
    rememberApproval,
  };
}
