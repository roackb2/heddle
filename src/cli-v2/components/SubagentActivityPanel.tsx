import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import {
  ClientSharedSessionDelegationService,
  type ClientSharedDelegationView,
} from '@/client-shared/services/session-delegations/index.js';

export function SubagentActivityPanel({ delegations }: { delegations: ClientSharedDelegationView[] }) {
  const [now, setNow] = useState(() => new Date());
  const hasRunningDelegation = delegations.some((delegation) => delegation.status === 'running');

  useEffect(() => {
    if (!hasRunningDelegation) {
      return undefined;
    }

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [hasRunningDelegation]);

  if (delegations.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Subagents <Text dimColor>· {delegations.length}</Text></Text>
      <Box flexDirection="column" paddingLeft={2}>
        {delegations.map((delegation) => (
          <SubagentRow delegation={delegation} key={delegation.delegationId} now={now} />
        ))}
      </Box>
    </Box>
  );
}

export function SubagentRow({
  delegation,
  now = new Date(),
}: {
  delegation: ClientSharedDelegationView;
  now?: Date;
}) {
  const status = resolveStatus(delegation);
  const duration = ClientSharedSessionDelegationService.formatDuration(
    delegation.startedAt,
    delegation.finishedAt ?? now,
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color="cyan">{delegation.agentName}</Text>
        <Text dimColor> · </Text>
        <Text color={status.color}>{status.label}</Text>
        <Text dimColor> · {duration}</Text>
      </Text>
      <Text>{delegation.task}</Text>
      {delegation.latestActivity ? (
        <Text dimColor>
          {delegation.latestActivity.label}
          {delegation.latestActivity.detail ? ` · ${delegation.latestActivity.detail}` : ''}
        </Text>
      ) : null}
      {delegation.summary ? <Text dimColor>{delegation.summary}</Text> : null}
      {delegation.error && !delegation.summary ? <Text color="red">{delegation.error}</Text> : null}
    </Box>
  );
}

function resolveStatus(delegation: ClientSharedDelegationView): { label: string; color: string } {
  if (delegation.status === 'running') {
    return { label: 'working', color: 'cyan' };
  }

  if (delegation.status === 'cancelled' || delegation.outcome === 'interrupted') {
    return { label: 'cancelled', color: 'yellow' };
  }

  if (delegation.outcome === 'error') {
    return { label: 'failed', color: 'red' };
  }

  if (delegation.outcome === 'max_steps') {
    return { label: 'step limit', color: 'yellow' };
  }

  return { label: delegation.outcome === 'done' ? 'done' : 'finished', color: 'green' };
}
