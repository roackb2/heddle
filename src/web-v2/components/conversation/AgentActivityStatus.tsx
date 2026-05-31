import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  ClientSharedSessionActivityService,
  type ClientSharedAgentActivityStatus,
  type ClientSharedSessionLatestUpdate,
} from '@/client-shared/services/session-activities';

type AgentActivityStatusProps = {
  currentActivity?: ClientSharedAgentActivityStatus;
  latestUpdate?: ClientSharedSessionLatestUpdate;
};

export function AgentActivityStatus({ currentActivity, latestUpdate }: AgentActivityStatusProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!currentActivity) {
      return undefined;
    }

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [currentActivity]);

  if (!currentActivity && !latestUpdate) {
    return null;
  }

  return (
    <div className="v2-agent-activity-stack" data-testid="web-v2-agent-activity-status">
      {latestUpdate ? <LatestActivityLine update={latestUpdate} /> : null}
      {currentActivity ? <CurrentActivityLine activity={currentActivity} now={now} /> : null}
    </div>
  );
}

function CurrentActivityLine({ activity, now }: { activity: ClientSharedAgentActivityStatus; now: Date }) {
  const elapsed = ClientSharedSessionActivityService.formatElapsed(activity.startedAt, now);

  return (
    <div className="v2-agent-activity-status" data-tone={activity.tone}>
      <Loader2 aria-hidden="true" className="v2-agent-activity-spinner motion-safe:animate-spin" />
      <span className="v2-agent-activity-label">{activity.label}</span>
      {activity.detail ? <span className="v2-agent-activity-detail">{activity.detail}</span> : null}
      <span className="v2-agent-activity-elapsed">{elapsed}</span>
    </div>
  );
}

function LatestActivityLine({ update }: { update: ClientSharedSessionLatestUpdate }) {
  return (
    <div className="v2-agent-latest-status" data-tone={update.tone}>
      <span className="v2-agent-latest-label">Latest: {update.label}</span>
      {update.detail ? <span className="v2-agent-activity-detail">{update.detail}</span> : null}
    </div>
  );
}
