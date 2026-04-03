import React from 'react';
import { Box, Text } from 'ink';
import { formatApprovalHint, summarizePendingApproval } from '../utils/format.js';
import type { ApprovalChoice, PendingApproval } from '../state/types.js';

export function ApprovalComposer({
  pendingApproval,
  approvalChoice,
}: {
  pendingApproval: PendingApproval;
  approvalChoice: ApprovalChoice;
}) {
  const summary = summarizePendingApproval(pendingApproval);

  return (
    <>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">{summary.title}</Text>
        {summary.command ?
          <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
            <Text color="cyan">{summary.command}</Text>
          </Box>
        : null}
        <Text dimColor>
          {[summary.scope, summary.capability, summary.risk ? `${summary.risk} risk` : undefined].filter(Boolean).join(' • ')}
        </Text>
        <Text>Why: {summary.why}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Effects</Text>
          {summary.effects.map((effect) => (
            <Text key={effect} dimColor>
              • {effect}
            </Text>
          ))}
        </Box>
      </Box>
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
        <Text dimColor>Approval stays in the conversation flow</Text>
      </Box>
    </>
  );
}

function ApprovalSelector({ choice }: { choice: ApprovalChoice }) {
  return (
    <Box marginBottom={0} flexWrap="wrap">
      <Text color={choice === 'approve' ? 'green' : 'gray'}>
        {choice === 'approve' ? '◉ Approve once' : '○ Approve once'}
      </Text>
      <Text dimColor>   </Text>
      <Text color={choice === 'allow_project' ? 'cyan' : 'gray'}>
        {choice === 'allow_project' ? '◉ Remember for project' : '○ Remember for project'}
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
