import { CheckCircle2Icon, CircleDotIcon, LoaderCircleIcon } from 'lucide-react';
import type { HostedAgentActivityView } from '../run-checkpoint.js';

type ActivityPanelProps = {
  activities: HostedAgentActivityView[];
  isRunning: boolean;
};

const toneIcons = {
  info: CircleDotIcon,
  running: LoaderCircleIcon,
  success: CheckCircle2Icon,
} as const;

export function ActivityPanel({ activities, isRunning }: ActivityPanelProps) {
  return (
    <aside className="flex min-h-0 flex-col border-t border-slate-800 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-balance text-sm font-semibold text-slate-200">Run activity</h2>
        <span className="text-xs tabular-nums text-slate-500">
          {isRunning ? 'Live' : `${activities.length} events`}
        </span>
      </div>
      {activities.length === 0 ? (
        <p className="text-pretty text-sm text-slate-500">
          Tool calls and lifecycle updates appear here while the agent works.
        </p>
      ) : (
        <ol className="space-y-4 overflow-y-auto pb-4">
          {activities.map((activity) => {
            const Icon = toneIcons[activity.tone];
            return (
              <li className="flex gap-3" key={activity.id}>
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{activity.label}</p>
                  {activity.detail ? (
                    <p className="line-clamp-2 text-pretty text-xs text-slate-500">
                      {activity.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
