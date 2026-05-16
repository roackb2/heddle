import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToolCall } from '@/core/types.js';
import {
  FileProjectApprovalRuleRepository,
  ProjectApprovalRules,
  type ProjectApprovalRule,
} from '@/core/approvals/remembered-rules/index.js';

export function useProjectApprovals(approvalsFile: string) {
  const repository = useMemo(() => new FileProjectApprovalRuleRepository(approvalsFile), [approvalsFile]);
  const [rules, setRules] = useState<ProjectApprovalRule[]>(() => repository.list());
  const rulesRef = useRef<ProjectApprovalRule[]>(rules);

  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);

  useEffect(() => {
    repository.save(rules);
  }, [repository, rules]);

  const isApproved = (call: ToolCall): boolean => {
    return Boolean(ProjectApprovalRules.findMatching({
      rules: rulesRef.current,
      tool: call.tool,
      input: call.input,
    }));
  };

  const rememberApproval = (call: ToolCall) => {
    const rule = ProjectApprovalRules.createForCall(call);
    if (!rule) {
      return;
    }

    if (ProjectApprovalRules.findMatching({
      rules: rulesRef.current,
      tool: rule.tool,
      input: rule.command,
    })) {
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
