import { useEffect, useRef, useState } from 'react';
import type { ToolCall } from '../../../index.js';
import {
  createProjectApprovalRuleForCall,
  findMatchingApprovalRule,
  loadProjectApprovalRules,
  saveProjectApprovalRules,
  type ProjectApprovalRule,
} from '../state/approval-rules.js';

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
    return Boolean(findMatchingApprovalRule(rulesRef.current, call.tool, call.input));
  };

  const rememberApproval = (call: ToolCall) => {
    const rule = createProjectApprovalRuleForCall(call);
    if (!rule) {
      return;
    }

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
