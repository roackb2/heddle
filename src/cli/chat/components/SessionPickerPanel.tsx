import React from 'react';
import { Box, Text } from 'ink';

const MAX_VISIBLE_SESSIONS = 8;

type SessionPickerItem = {
  id: string;
  name: string;
};

export function SessionPickerPanel({
  query,
  sessions,
  activeSessionId,
  highlightedIndex,
}: {
  query: string;
  sessions: SessionPickerItem[];
  activeSessionId: string;
  highlightedIndex: number;
}) {
  const { visibleSessions, startIndex } = getVisibleSessions(sessions, highlightedIndex);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Session picker</Text>
      <Text dimColor>
        {query ? `Search: ${query}` : 'Type after /session choose to filter. Use ↑/↓ or Tab to choose.'}
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
  sessions: SessionPickerItem[],
  highlightedIndex: number,
): { visibleSessions: SessionPickerItem[]; startIndex: number } {
  if (sessions.length <= MAX_VISIBLE_SESSIONS) {
    return { visibleSessions: sessions, startIndex: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_SESSIONS / 2);
  let startIndex = Math.max(0, highlightedIndex - half);
  const maxStart = Math.max(0, sessions.length - MAX_VISIBLE_SESSIONS);
  if (startIndex > maxStart) {
    startIndex = maxStart;
  }

  return {
    visibleSessions: sessions.slice(startIndex, startIndex + MAX_VISIBLE_SESSIONS),
    startIndex,
  };
}
