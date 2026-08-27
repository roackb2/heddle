import React from 'react';
import { Box, Text } from 'ink';
import type { ClientSharedConversationTimelineDelegationGroupItem } from '@/client-shared/services/session-turn-presentation/index.js';
import { SubagentRow } from './SubagentActivityPanel.js';

export function ConversationTurnDelegationBlock({
  item,
}: {
  item: ClientSharedConversationTimelineDelegationGroupItem;
}) {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Subagent results <Text dimColor>· {item.delegations.length}</Text></Text>
      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        {item.delegations.map((delegation) => (
          <SubagentRow delegation={delegation} key={delegation.delegationId} />
        ))}
      </Box>
    </Box>
  );
}
