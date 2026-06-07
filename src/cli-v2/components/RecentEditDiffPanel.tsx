import React from 'react';
import { Box, Text } from 'ink';
import uniqBy from 'lodash/uniqBy.js';
import type { ClientSharedRecentEditDiff } from '@/client-shared/services/session-activities/index.js';
import type { RecentEditDiffReviewState } from '../hooks/useRecentEditDiffReview.js';
import { DiffPatchBlock } from './DiffPatchBlock.js';

const actionLabels: Record<string, string> = {
  create: 'created',
  delete: 'deleted',
  replace: 'edited',
  update: 'edited',
};

type RecentEditDiffPanelProps = {
  diffs: ClientSharedRecentEditDiff[];
  review: RecentEditDiffReviewState;
  running: boolean;
};

export function RecentEditDiffPanel({ diffs, review, running }: RecentEditDiffPanelProps) {
  if (diffs.length === 0) {
    return null;
  }

  if (review.mode === 'review' && review.selectedDiff) {
    return <RecentEditDiffReviewPanel diffs={diffs} review={review} />;
  }

  return <RecentEditDiffSummary diffs={diffs} running={running} />;
}

function RecentEditDiffSummary({
  diffs,
  running,
}: {
  diffs: ClientSharedRecentEditDiff[];
  running: boolean;
}) {
  return (
    <Box marginTop={1}>
      <Text dimColor>Recent edits: </Text>
      <Text>{formatDiffScope(diffs)}</Text>
      <Text dimColor>{running ? ' · run active' : ' · run done'}</Text>
      <Text dimColor> · type </Text>
      <Text color="cyan">/d</Text>
      <Text dimColor> to review</Text>
    </Box>
  );
}

function RecentEditDiffReviewPanel({
  diffs,
  review,
}: {
  diffs: ClientSharedRecentEditDiff[];
  review: RecentEditDiffReviewState;
}) {
  const diff = review.selectedDiff;
  if (!diff) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text>
        <Text bold>Diff review</Text>
        <Text dimColor> · {formatDiffScope(diffs)}</Text>
        <Text dimColor> · Esc close</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text dimColor>[{review.selectedIndex + 1}/{diffs.length}] </Text>
          <Text color="cyan">{diff.path}</Text>
          <Text dimColor>{formatEditMeta(diff)}</Text>
        </Text>
        <DiffPatchBlock id={diff.id} patch={diff.patch} truncated={diff.truncated} />
      </Box>
      <Text dimColor>j/k or arrows move · n/p file · esc back</Text>
    </Box>
  );
}

function formatDiffScope(diffs: ClientSharedRecentEditDiff[]): string {
  const editCount = diffs.length;
  const fileCount = uniqBy(diffs, 'path').length;
  return `${editCount} ${editCount === 1 ? 'edit' : 'edits'} across ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
}

function formatEditMeta(diff: ClientSharedRecentEditDiff): string {
  const action = diff.action ? actionLabels[diff.action] ?? diff.action : undefined;
  const step = typeof diff.step === 'number' ? `step ${diff.step}` : undefined;
  return [action, step].filter(Boolean).map((value) => ` · ${value}`).join('');
}
