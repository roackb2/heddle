import React from 'react';
import { Box, Text } from 'ink';
import type { ClientSharedSessionPlan } from '@/client-shared/services/session-activities/index.js';

const statusGlyphs = {
  pending: '○',
  in_progress: '●',
  completed: '✓',
} satisfies Record<ClientSharedSessionPlan['items'][number]['status'], string>;

type AgentPlanPanelProps = {
  plan?: ClientSharedSessionPlan;
};

export function AgentPlanPanel({ plan }: AgentPlanPanelProps) {
  if (!plan) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text bold>Plan</Text>
      {plan.explanation ? <Text color="gray">{plan.explanation}</Text> : null}
      {plan.items.map((item) => (
        <Text key={`${item.status}:${item.step}`} color={item.status === 'in_progress' ? 'cyan' : undefined}>
          {statusGlyphs[item.status]} {item.step}
        </Text>
      ))}
    </Box>
  );
}
