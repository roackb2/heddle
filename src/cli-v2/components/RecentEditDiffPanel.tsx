import React from 'react';
import { Box, Text } from 'ink';
import type { ClientSharedRecentEditDiff } from '@/client-shared/services/session-activities/index.js';

const MAX_VISIBLE_DIFFS = 3;
const MAX_VISIBLE_LINES = 120;
const MAX_LINE_LENGTH = 160;

const actionLabels: Record<string, string> = {
  create: 'created',
  delete: 'deleted',
  replace: 'edited',
  update: 'edited',
};

type RecentEditDiffPanelProps = {
  diffs: ClientSharedRecentEditDiff[];
};

type RenderedDiff = {
  lines: string[];
  truncated: boolean;
};

export function RecentEditDiffPanel({ diffs }: RecentEditDiffPanelProps) {
  const visibleDiffs = diffs.slice(-MAX_VISIBLE_DIFFS);
  if (visibleDiffs.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text bold>Recent edits</Text>
      {visibleDiffs.map((diff) => (
        <Box key={diff.id} flexDirection="column" marginTop={1}>
          <Text>
            <Text color="cyan">{diff.path}</Text>
            <Text dimColor>{formatEditMeta(diff)}</Text>
          </Text>
          {renderPatch(diff)}
        </Box>
      ))}
    </Box>
  );
}

function formatEditMeta(diff: ClientSharedRecentEditDiff): string {
  const action = diff.action ? actionLabels[diff.action] ?? diff.action : undefined;
  const step = typeof diff.step === 'number' ? `step ${diff.step}` : undefined;
  return [action, step].filter(Boolean).map((value) => ` · ${value}`).join('');
}

function renderPatch(diff: ClientSharedRecentEditDiff) {
  const { lines, truncated } = preparePatchLines(diff.patch);
  return (
    <>
      {lines.map((line, index) => (
        <Text key={`${diff.id}:${index}`} color={resolveDiffLineColor(line)} dimColor={isDiffHeaderLine(line)}>
          {line}
        </Text>
      ))}
      {diff.truncated || truncated ? <Text color="yellow">Diff preview truncated.</Text> : null}
    </>
  );
}

function preparePatchLines(patch: string): RenderedDiff {
  const rawLines = patch.split('\n');
  const visibleLines = rawLines.slice(0, MAX_VISIBLE_LINES).map(truncateLine);
  return {
    lines: visibleLines,
    truncated: rawLines.length > visibleLines.length,
  };
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) {
    return line;
  }

  return `${line.slice(0, MAX_LINE_LENGTH - 3)}...`;
}

function resolveDiffLineColor(line: string): string | undefined {
  if (line.startsWith('@@')) {
    return 'cyan';
  }

  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'green';
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'red';
  }

  return undefined;
}

function isDiffHeaderLine(line: string): boolean {
  return line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++');
}
