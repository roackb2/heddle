import React from 'react';
import { Box, Text } from 'ink';
import type { ClientSharedConversationTimelineActivityItem } from '@/client-shared/services/session-turn-presentation/index.js';
import { DiffPatchBlock } from './DiffPatchBlock.js';

const INLINE_DIFF_MAX_VISIBLE_LINES = 80;

const approvalStatusColors: Record<string, string> = {
  approved: 'green',
  denied: 'red',
  requested: 'yellow',
};

const editActionLabels: Record<string, string> = {
  create: 'created',
  delete: 'deleted',
  replace: 'edited',
  update: 'edited',
};

// Owns cli-v2 presentation for persisted turn activity blocks. The activity
// facts come from core/API metadata; this component only chooses terminal
// labels, colors, and inline diff limits.
export function ConversationTurnActivityBlock({ item }: { item: ClientSharedConversationTimelineActivityItem }) {
  if (item.activity.type === 'approval') {
    return <ApprovalActivityBlock item={item} />;
  }

  return <EditDiffActivityBlock item={item} />;
}

function ApprovalActivityBlock({ item }: { item: ClientSharedConversationTimelineActivityItem }) {
  if (item.activity.type !== 'approval') {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        <Text bold>Approval</Text>
        <Text dimColor> · </Text>
        <Text color={approvalStatusColors[item.activity.status]}>{item.activity.status}</Text>
        <ActivityStep step={item.activity.step} />
      </Text>
      <Text>
        <Text dimColor>tool </Text>
        <Text>{item.activity.tool}</Text>
      </Text>
      <Text>{item.activity.summary}</Text>
      {item.activity.command ? (
        <Text>
          <Text dimColor>command </Text>
          <Text>{item.activity.command}</Text>
        </Text>
      ) : null}
      {item.activity.reason ? <Text dimColor>{item.activity.reason}</Text> : null}
    </Box>
  );
}

function EditDiffActivityBlock({ item }: { item: ClientSharedConversationTimelineActivityItem }) {
  if (item.activity.type !== 'edit_diff') {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        <Text bold>Edit diff</Text>
        <Text dimColor> · </Text>
        <Text color="cyan">{item.activity.path}</Text>
        <Text dimColor>{formatEditMeta(item.activity.action)}</Text>
        <ActivityStep step={item.activity.step} />
      </Text>
      <DiffPatchBlock
        id={item.activity.id}
        maxVisibleLines={INLINE_DIFF_MAX_VISIBLE_LINES}
        patch={item.activity.patch ?? ''}
        truncated={item.activity.truncated}
      />
    </Box>
  );
}

function ActivityStep({ step }: { step?: number }) {
  return typeof step === 'number' ? <Text dimColor> · step {step}</Text> : null;
}

function formatEditMeta(action: string | undefined): string {
  if (!action) {
    return '';
  }

  return ` · ${editActionLabels[action] ?? action}`;
}
