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
      {pendingApproval.editPreview ?
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          marginTop={1}
          marginBottom={1}
          paddingX={1}
        >
          <Text bold>Diff Preview</Text>
          {pendingApproval.editPreview.diff.split('\n').map((line, index) => (
            <Text key={`${pendingApproval.editPreview?.path}-${index}`} color={diffLineColor(line)}>
              {line}
            </Text>
          ))}
          {pendingApproval.editPreview.truncated ? <Text dimColor>Preview truncated</Text> : null}
        </Box>
      : null}
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

function diffLineColor(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'gray';
  }
  if (line.startsWith('@@')) {
    return 'yellow';
  }
  if (line.startsWith('+')) {
    return 'green';
  }
  if (line.startsWith('-')) {
    return 'red';
  }
  return undefined;
}
