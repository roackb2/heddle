import React from 'react';
import { Box, Text } from 'ink';
import { currentActivityText, truncate } from '../utils/format.js';
import type { LiveEvent, PendingApproval } from '../state/types.js';

export function ActivityPanel({
  isRunning,
  workingFrame,
  elapsedSeconds,
  liveEvents,
  pendingApproval,
  interruptRequested,
}: {
  isRunning: boolean;
  workingFrame: number;
  elapsedSeconds: number;
  liveEvents: LiveEvent[];
  pendingApproval?: PendingApproval;
  interruptRequested: boolean;
}) {
  const visibleEvents = isRunning ? liveEvents.slice(-3) : liveEvents.slice(-1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Current Activity</Text>
      <Text color={pendingApproval ? 'yellow' : interruptRequested ? 'yellow' : isRunning ? 'yellow' : 'gray'}>
        {currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested)}
      </Text>
      {visibleEvents.map((event) => (
        <Box key={event.id}>
          <Text dimColor>{truncate(event.text, 160)}</Text>
        </Box>
      ))}
    </Box>
  );
}
