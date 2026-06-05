import React from 'react';
import { Box, Text } from 'ink';
import type { ClientSharedConversationTimelineActivityGroupItem } from '@/client-shared/services/session-turn-presentation/index.js';
import { DiffPatchBlock } from './DiffPatchBlock.js';

const INLINE_DIFF_MAX_VISIBLE_LINES = 80;
type ConversationTurnActivity = ClientSharedConversationTimelineActivityGroupItem['activities'][number];

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
export function ConversationTurnActivityBlock({
  expanded,
  item,
}: {
  expanded: boolean;
  item: ClientSharedConversationTimelineActivityGroupItem;
}) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">Agent tool activities</Text>
        <Text dimColor> · {formatActivityCount(item.activities.length)}</Text>
        <Text dimColor>{expanded ? ' · press a to collapse' : ' · press a to expand'}</Text>
      </Text>
      {expanded ? (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {item.activities.map((activity) => (
            <ActivityBlock key={activity.id} activity={activity} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function ActivityBlock({ activity }: { activity: ConversationTurnActivity }) {
  if (activity.type === 'approval') {
    return <ApprovalActivityBlock activity={activity} />;
  }

  return <EditDiffActivityBlock activity={activity} />;
}

function ApprovalActivityBlock({ activity }: { activity: ConversationTurnActivity }) {
  if (activity.type !== 'approval') {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold>Approval</Text>
        <Text dimColor> · </Text>
        <Text color={approvalStatusColors[activity.status]}>{activity.status}</Text>
        <ActivityStep step={activity.step} />
      </Text>
      <Text>
        <Text dimColor>tool </Text>
        <Text>{activity.tool}</Text>
      </Text>
      <Text>{activity.summary}</Text>
      {activity.command ? (
        <Text>
          <Text dimColor>command </Text>
          <Text>{activity.command}</Text>
        </Text>
      ) : null}
      {activity.reason ? <Text dimColor>{activity.reason}</Text> : null}
    </Box>
  );
}

function EditDiffActivityBlock({ activity }: { activity: ConversationTurnActivity }) {
  if (activity.type !== 'edit_diff') {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold>Edit diff</Text>
        <Text dimColor> · </Text>
        <Text color="cyan">{activity.path}</Text>
        <Text dimColor>{formatEditMeta(activity.action)}</Text>
        <ActivityStep step={activity.step} />
      </Text>
      <DiffPatchBlock
        id={activity.id}
        maxVisibleLines={INLINE_DIFF_MAX_VISIBLE_LINES}
        patch={activity.patch ?? ''}
        truncated={activity.truncated}
      />
    </Box>
  );
}

function formatActivityCount(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
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
