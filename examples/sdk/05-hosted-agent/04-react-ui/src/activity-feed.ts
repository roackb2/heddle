import type { HostedAgentRunEvent } from '../../02-http-sse-api/contracts.js';
import type { HostedAgentActivityView } from './run-checkpoint.js';

const MAX_VISIBLE_ACTIVITIES = 8;

export function appendHostedAgentActivity(
  activities: HostedAgentActivityView[],
  event: Extract<HostedAgentRunEvent, { kind: 'activity' }>,
): HostedAgentActivityView[] {
  if (event.activity.type === 'assistant.stream') {
    return activities;
  }

  return [
    ...activities,
    {
      id: `${event.runId}:${event.sequence}`,
      ...activityLabel(event.activity),
    },
  ].slice(-MAX_VISIBLE_ACTIVITIES);
}

function activityLabel(activity: Extract<HostedAgentRunEvent, { kind: 'activity' }>['activity']): Omit<
  HostedAgentActivityView,
  'id'
> {
  if (activity.type === 'tool.calling') {
    return {
      label: `Running ${activity.tool ?? 'tool'}`,
      detail: activity.step === undefined ? undefined : `Step ${activity.step}`,
      tone: 'running',
    };
  }
  if (activity.type === 'tool.completed') {
    return {
      label: `${activity.tool ?? 'Tool'} completed`,
      detail: activity.durationMs === undefined ? undefined : `${Math.round(activity.durationMs)} ms`,
      tone: 'success',
    };
  }
  if (activity.type === 'loop.started') {
    return { label: 'Agent started', tone: 'running' };
  }
  if (activity.type === 'loop.finished') {
    return {
      label: 'Agent finished',
      detail: activity.outcome,
      tone: 'success',
    };
  }
  return {
    label: activity.type.replaceAll('.', ' '),
    tone: 'info',
  };
}
