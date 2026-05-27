import { Box, Text, useInput } from 'ink';
import type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
} from '@/client-shared/api/types.js';
import {
  formatApprovalPayload,
  resolveApprovalDecision,
  resolveApprovalInputDetail,
  resolveAvailableApprovalChoices,
  type ApprovalChoice,
} from '../helpers/approvals/pending-approval.js';

type ApprovalPanelProps = {
  approval: NonNullable<ControlPlanePendingApproval>;
  resolving: boolean;
  onResolve: (decision: ControlPlaneApprovalDecision) => void;
};

export function ApprovalPanel({ approval, resolving, onResolve }: ApprovalPanelProps) {
  const choices = resolveAvailableApprovalChoices(approval);
  const detail = resolveApprovalInputDetail(approval.input);
  const payload = detail ? undefined : formatApprovalPayload(approval.input);

  useInput((input) => {
    if (resolving) {
      return;
    }

    const choice = resolveChoiceKey(input, choices);
    if (!choice) {
      return;
    }

    onResolve(resolveApprovalDecision(choice, approval));
  }, { isActive: !resolving });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text color="yellow" bold>Approval requested</Text>
      <Text>
        <Text dimColor>tool </Text>
        {approval.tool}
      </Text>
      <Text>
        <Text dimColor>summary </Text>
        {approval.summary}
      </Text>
      {detail ? (
        <Text>
          <Text dimColor>{detail.label} </Text>
          {detail.value}
        </Text>
      ) : null}
      {approval.reason ? (
        <Text>
          <Text dimColor>reason </Text>
          {approval.reason}
        </Text>
      ) : null}
      {approval.editPreview ? (
        <Text>
          <Text dimColor>edit </Text>
          {approval.editPreview.action}: {approval.editPreview.path}
          {approval.editPreview.truncated ? ' (truncated)' : ''}
        </Text>
      ) : null}
      {payload ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>payload</Text>
          {payload.split(/\r?\n/).map((line, index) => (
            <Text key={`approval-payload-${index}`}>{line || ' '}</Text>
          ))}
        </Box>
      ) : null}
      <Text color={resolving ? 'gray' : 'cyan'}>
        {formatChoiceHint(choices)}
      </Text>
    </Box>
  );
}

function resolveChoiceKey(input: string, choices: ApprovalChoice[]): ApprovalChoice | undefined {
  if (input === 'a') {
    return 'approve';
  }

  if (input === 'r' && choices.includes('allow_project')) {
    return 'allow_project';
  }

  if (input === 'd') {
    return 'deny';
  }

  return undefined;
}

function formatChoiceHint(choices: ApprovalChoice[]): string {
  return choices.includes('allow_project')
    ? '[a] approve once  [r] remember for project  [d] deny'
    : '[a] approve once  [d] deny';
}
