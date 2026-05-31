import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import {
  ClientSharedSessionActivityService,
  type ClientSharedAgentActivityStatus,
} from '@/client-shared/services/session-activities/index.js';
import type { PromptActivityView } from '../services/activities/prompt-activity-service.js';

type PromptStatusPanelProps = {
  currentActivity?: ClientSharedAgentActivityStatus;
  latestActivity?: PromptActivityView;
};

export function PromptStatusPanel({ currentActivity, latestActivity }: PromptStatusPanelProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!currentActivity) {
      return undefined;
    }

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [currentActivity]);

  if (!currentActivity && !latestActivity) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {latestActivity ? <Text color={latestActivity.color}>{latestActivity.text}</Text> : null}
      {currentActivity ? (
        <Text color={currentActivity.tone === 'warning' ? 'yellow' : 'cyan'}>
          {formatCurrentActivity(currentActivity, now)}
        </Text>
      ) : null}
    </Box>
  );
}

function formatCurrentActivity(activity: ClientSharedAgentActivityStatus, now: Date): string {
  const elapsed = ClientSharedSessionActivityService.formatElapsed(activity.startedAt, now);
  const detail = activity.detail ? ` · ${activity.detail}` : '';
  return activity.label === 'Thinking'
    ? `Thinking... ${elapsed}`
    : `${activity.label}${detail} · ${elapsed}`;
}
