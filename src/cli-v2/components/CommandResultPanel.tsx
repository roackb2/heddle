import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSlashCommandResult } from '@/client-shared/api/types.js';

export function CommandResultPanel({
  results,
}: {
  results: ControlPlaneSlashCommandResult[];
}) {
  const visibleResults = results.filter((result) => result.handled);
  if (visibleResults.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {visibleResults.map((result, index) => (
        <Box key={index} flexDirection="column">
          <Text color="green">Command</Text>
          {renderResult(result)}
        </Box>
      ))}
    </Box>
  );
}

function renderResult(result: Extract<ControlPlaneSlashCommandResult, { handled: true }>) {
  if (result.kind === 'message') {
    return <Text>{result.message}</Text>;
  }

  if (result.kind === 'continue') {
    return <Text>{result.message ?? 'Continuing session.'}</Text>;
  }

  return <Text>{result.message ?? result.displayText}</Text>;
}
