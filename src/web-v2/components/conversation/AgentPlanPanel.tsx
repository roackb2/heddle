import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, Loader2 } from 'lucide-react';
import type { ClientSharedSessionPlan } from '@/client-shared/services/session-activities';

type AgentPlanPanelProps = {
  plan: ClientSharedSessionPlan;
};

const statusIcons = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
} satisfies Record<ClientSharedSessionPlan['items'][number]['status'], typeof Circle>;

const mobilePlanQuery = '(max-width: 38rem)';

export function AgentPlanPanel({ plan }: AgentPlanPanelProps) {
  const [open, setOpen] = useState(() => shouldDefaultOpen());
  const activeStep = plan.items.find((item) => item.status === 'in_progress') ?? plan.items.find((item) => item.status !== 'completed') ?? plan.items.at(-1);

  useEffect(() => {
    setOpen(shouldDefaultOpen());
  }, [plan.runId]);

  return (
    <details
      className="v2-agent-plan-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="v2-agent-plan-summary">
        <ChevronDown aria-hidden="true" className="v2-agent-plan-toggle" />
        <span className="v2-agent-plan-kicker">Plan</span>
        {activeStep ? <span className="v2-agent-plan-current">{activeStep.step}</span> : null}
      </summary>
      {plan.explanation ? <p className="v2-agent-plan-explanation">{plan.explanation}</p> : null}
      <ol className="v2-agent-plan-list">
        {plan.items.map((item) => {
          const StatusIcon = statusIcons[item.status];
          return (
            <li className="v2-agent-plan-item" data-status={item.status} key={`${item.status}:${item.step}`}>
              <StatusIcon aria-hidden="true" className={item.status === 'in_progress' ? 'animate-spin' : undefined} />
              <span>{item.step}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function shouldDefaultOpen(): boolean {
  return typeof window === 'undefined' || !window.matchMedia?.(mobilePlanQuery).matches;
}
