import React from 'react';
import { Box, Text } from 'ink';
import type { ControlPlaneSlashCommandResult } from '@/client-shared/api/types.js';

export function CommandResultPanel({
  expanded,
  results,
}: {
  expanded: boolean;
  results: ControlPlaneSlashCommandResult[];
}) {
  const visibleResults = results.filter(isHandledResult);
  if (visibleResults.length === 0) {
    return null;
  }

  if (!expanded) {
    return <CollapsedCommandResult result={visibleResults.at(-1)} />;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="green">Command</Text>
        <Text dimColor> · press c to collapse</Text>
      </Text>
      {visibleResults.map((result, index) => (
        <Box key={index} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
          {renderResult(result)}
        </Box>
      ))}
    </Box>
  );
}

function CollapsedCommandResult({
  result,
}: {
  result?: Extract<ControlPlaneSlashCommandResult, { handled: true }>;
}) {
  if (!result) {
    return null;
  }

  return (
    <Box marginTop={1}>
      <Text>
        <Text color="green">Command</Text>
        <Text dimColor> · {summarizeResult(result)}</Text>
        <Text dimColor> · press c to expand</Text>
      </Text>
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

function isHandledResult(
  result: ControlPlaneSlashCommandResult,
): result is Extract<ControlPlaneSlashCommandResult, { handled: true }> {
  return result.handled;
}

function summarizeResult(result: Extract<ControlPlaneSlashCommandResult, { handled: true }>): string {
  const text = result.kind === 'execute'
    ? (result.message ?? result.displayText)
    : result.message;
  const firstLine = text?.split(/\r?\n/, 1)[0]?.trim();

  if (!firstLine) {
    return result.kind === 'continue' ? 'continuing session' : result.kind;
  }

  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
