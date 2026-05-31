import React from 'react';
import { Box, Text } from 'ink';
import type { CliV2SessionPickerItem } from '../services/pickers/index.js';

const MAX_VISIBLE_SESSIONS = 8;

export function SessionPickerPanel({
  query,
  sessions,
  activeSessionId,
  highlightedIndex,
}: {
  query: string;
  sessions: CliV2SessionPickerItem[];
  activeSessionId?: string;
  highlightedIndex: number;
}) {
  const { visibleSessions, startIndex } = getVisibleSessions(sessions, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Session picker</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after /session choose to filter. Use up/down or Tab to choose.'}
      </Text>
      {visibleSessions.length > 0 ?
        visibleSessions.map((session, index) => {
          const absoluteIndex = startIndex + index;
          const isHighlighted = absoluteIndex === highlightedIndex;
          const isActive = session.id === activeSessionId;
          const marker = isHighlighted ? '◉' : '○';
          const suffix = isActive ? ' (current)' : '';
          return (
            <Text key={session.id} color={isHighlighted ? 'cyan' : undefined} dimColor={!isHighlighted}>
              {`${marker} ${absoluteIndex + 1}. ${session.name} [${session.id}]${suffix}`}
            </Text>
          );
        })
      : <Text dimColor>No matching sessions.</Text>}
    </Box>
  );
}

function getVisibleSessions(
  sessions: CliV2SessionPickerItem[],
  highlightedIndex: number,
): { visibleSessions: CliV2SessionPickerItem[]; startIndex: number } {
  if (sessions.length <= MAX_VISIBLE_SESSIONS) {
    return { visibleSessions: sessions, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_SESSIONS / 2);
  const startIndex = Math.min(
    Math.max(0, highlightedIndex - half),
    Math.max(0, sessions.length - MAX_VISIBLE_SESSIONS),
  );

  return {
    visibleSessions: sessions.slice(startIndex, startIndex + MAX_VISIBLE_SESSIONS),
    startIndex,
  };
}
