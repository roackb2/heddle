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
  error,
}: {
  isRunning: boolean;
  workingFrame: number;
  elapsedSeconds: number;
  liveEvents: LiveEvent[];
  pendingApproval?: PendingApproval;
  interruptRequested: boolean;
  error?: string;
}) {
  if (!isRunning && !pendingApproval && !interruptRequested && !error) {
    return null;
  }

  const visibleEvents = isRunning ? liveEvents.slice(-3) : liveEvents.slice(-1);
  const activityText = currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested);
  const dedupedEvents = visibleEvents.filter((event, index, events) => {
    if (event.text === activityText) {
      return false;
    }

    return events.findIndex((candidate) => candidate.text === event.text) === index;
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Current Activity</Text>
      <Text color={pendingApproval ? 'yellow' : interruptRequested ? 'yellow' : isRunning ? 'yellow' : 'gray'}>
        {activityText}
      </Text>
      {dedupedEvents.map((event) => (
        <Box key={event.id}>
          <Text dimColor>{truncate(event.text, 160)}</Text>
        </Box>
      ))}
      {error ?
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Last error</Text>
          <Text color="red">{error}</Text>
        </Box>
      : null}
    </Box>
  );
}
