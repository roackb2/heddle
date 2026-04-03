import React from 'react';
import { Box, Text } from 'ink';
import { truncate } from '../utils/format.js';
import type { TurnSummary } from '../state/types.js';

export function RecentTurnsPanel({ turns }: { turns: TurnSummary[] }) {
  const latestTurn = turns[turns.length - 1];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Recent Turns</Text>
      {!latestTurn ?
        <Text dimColor>No completed turns yet.</Text>
      : (
        <Box flexDirection="column">
          <Text color="magenta">{truncate(latestTurn.prompt, 120)}</Text>
          <Text dimColor>outcome={latestTurn.outcome} steps={latestTurn.steps} trace={latestTurn.traceFile}</Text>
          {latestTurn.outcome !== 'done' ? <Text color="red">{latestTurn.summary}</Text> : null}
          <Text dimColor>{latestTurn.events.slice(0, 4).map((event) => truncate(event, 160)).join(' • ')}</Text>
        </Box>
      )}
    </Box>
  );
}
