import React from 'react';
import { Text } from 'ink';

const DEFAULT_MAX_VISIBLE_LINES = 120;
const DEFAULT_MAX_LINE_LENGTH = 160;

type DiffPatchBlockProps = {
  id: string;
  patch: string;
  truncated?: boolean;
  maxVisibleLines?: number;
  maxLineLength?: number;
};

type RenderedDiff = {
  lines: string[];
  truncated: boolean;
};

// Owns terminal-safe unified diff rendering for cli-v2 surfaces. It does not
// decide which diffs belong in conversation history or live review mode.
export function DiffPatchBlock({
  id,
  maxLineLength = DEFAULT_MAX_LINE_LENGTH,
  maxVisibleLines = DEFAULT_MAX_VISIBLE_LINES,
  patch,
  truncated = false,
}: DiffPatchBlockProps) {
  const rendered = preparePatchLines({ maxLineLength, maxVisibleLines, patch });

  return (
    <>
      {rendered.lines.map((line, index) => (
        <Text key={`${id}:${index}`} color={resolveDiffLineColor(line)} dimColor={isDiffHeaderLine(line)}>
          {line}
        </Text>
      ))}
      {truncated || rendered.truncated ? <Text color="yellow">Diff preview truncated.</Text> : null}
    </>
  );
}

function preparePatchLines({
  maxLineLength,
  maxVisibleLines,
  patch,
}: {
  maxLineLength: number;
  maxVisibleLines: number;
  patch: string;
}): RenderedDiff {
  const rawLines = patch.split('\n');
  const visibleLines = rawLines.slice(0, maxVisibleLines).map((line) => truncateLine(line, maxLineLength));
  return {
    lines: visibleLines,
    truncated: rawLines.length > visibleLines.length,
  };
}

function truncateLine(line: string, maxLineLength: number): string {
  if (line.length <= maxLineLength) {
    return line;
  }

  return `${line.slice(0, maxLineLength - 3)}...`;
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
