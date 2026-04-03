import React from 'react';
import { Box, Text } from 'ink';
import { formatApprovalHint, formatApprovalPrompt } from '../utils/format.js';
import type { ApprovalChoice, PendingApproval } from '../state/types.js';

export function ApprovalComposer({
  pendingApproval,
  approvalChoice,
}: {
  pendingApproval: PendingApproval;
  approvalChoice: ApprovalChoice;
}) {
  return (
    <>
      <Text color="white">{formatApprovalPrompt(pendingApproval)}</Text>
      <Text dimColor>{formatApprovalHint(pendingApproval)}</Text>
      <ApprovalSelector choice={approvalChoice} />
      <Box justifyContent="space-between">
        <Text dimColor>Use ←/→ then Enter</Text>
        <Text dimColor>Input paused during approval</Text>
      </Box>
    </>
  );
}

function ApprovalSelector({ choice }: { choice: ApprovalChoice }) {
  return (
    <Box marginBottom={0}>
      <Text color={choice === 'approve' ? 'green' : 'gray'}>
        {choice === 'approve' ? '◉ Approve' : '○ Approve'}
      </Text>
      <Text dimColor>   </Text>
      <Text color={choice === 'allow_project' ? 'cyan' : 'gray'}>
        {choice === 'allow_project' ? '◉ Remember' : '○ Remember'}
      </Text>
      <Text dimColor>   </Text>
      <Text color={choice === 'deny' ? 'red' : 'gray'}>
        {choice === 'deny' ? '◉ Deny' : '○ Deny'}
      </Text>
    </Box>
  );
}
