import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneWorkspaceChangedFile } from '@/client-shared/api/types.js';

const MAX_VISIBLE_CHANGED_FILES = 8;

const statusColors: Record<ControlPlaneWorkspaceChangedFile['status'], 'blue' | 'cyan' | 'green' | 'red' | 'yellow'> = {
  added: 'green',
  copied: 'cyan',
  deleted: 'red',
  modified: 'yellow',
  renamed: 'blue',
  unknown: 'yellow',
  untracked: 'green',
};

type ChangedFilesPanelProps = {
  files: ControlPlaneWorkspaceChangedFile[];
};

/** Renders the current control-plane Git change set in a bounded terminal view. */
export function ChangedFilesPanel({ files }: ChangedFilesPanelProps) {
  if (files.length === 0) {
    return null;
  }

  const visibleFiles = files.slice(0, MAX_VISIBLE_CHANGED_FILES);
  const hiddenCount = files.length - visibleFiles.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold>Changed files</Text>
        <Text dimColor> · {files.length}</Text>
      </Text>
      {visibleFiles.map((file) => (
        <Text key={`${file.status}:${file.oldPath ?? ''}:${file.path}`}>
          <Text color={statusColors[file.status]}>{file.status}</Text>
          <Text> </Text>
          <Text color="cyan">{formatWorkspacePath(file.path)}</Text>
          {file.status === 'renamed' && file.oldPath ? (
            <Text dimColor> ← {formatWorkspacePath(file.oldPath)}</Text>
          ) : null}
        </Text>
      ))}
      {hiddenCount > 0 ? <Text dimColor>… and {hiddenCount} more</Text> : null}
    </Box>
  );
}

function formatWorkspacePath(path: string): string {
  return path.startsWith('./') ? path : `./${path}`;
}
