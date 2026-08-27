import type { ClientSharedDelegationView } from '@/client-shared/services/session-delegations';
import { ClientSharedSessionDelegationService } from '@/client-shared/services/session-delegations';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';

type SubagentActivityListProps = {
  delegations: ClientSharedDelegationView[];
  now?: Date;
};

type SubagentStatus = 'running' | 'done' | 'finished' | 'stepLimit' | 'failed' | 'cancelled';

const statusMessageKeys = {
  running: 'subagents.status.running',
  done: 'subagents.status.done',
  finished: 'subagents.status.finished',
  stepLimit: 'subagents.status.stepLimit',
  failed: 'subagents.status.failed',
  cancelled: 'subagents.status.cancelled',
} as const satisfies Record<SubagentStatus, I18nMessageKey>;

export function SubagentActivityList({ delegations, now = new Date() }: SubagentActivityListProps) {
  const { t } = useI18n();

  return (
    <ul className="v2-subagent-activity-list">
      {delegations.map((delegation) => {
        const status = resolveStatus(delegation);
        return (
          <li
            className="v2-subagent-activity-item"
            data-status={status}
            key={delegation.delegationId}
          >
            <div className="v2-subagent-activity-header">
              <span className="v2-subagent-activity-agent">{delegation.agentName}</span>
              <span className="v2-subagent-activity-status">{t(statusMessageKeys[status])}</span>
              <span className="v2-subagent-activity-duration tabular-nums">
                {ClientSharedSessionDelegationService.formatDuration(
                  delegation.startedAt,
                  delegation.finishedAt ?? now,
                )}
              </span>
            </div>
            <p className="v2-subagent-activity-task text-pretty">{delegation.task}</p>
            {delegation.latestActivity ? (
              <p className="v2-subagent-activity-detail text-pretty">
                {delegation.latestActivity.label}
                {delegation.latestActivity.detail ? ` · ${delegation.latestActivity.detail}` : ''}
              </p>
            ) : null}
            {delegation.summary ? (
              <p className="v2-subagent-activity-summary text-pretty">{delegation.summary}</p>
            ) : null}
            {delegation.error && !delegation.summary ? (
              <p className="v2-subagent-activity-error text-pretty">{delegation.error}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function resolveStatus(delegation: ClientSharedDelegationView): SubagentStatus {
  if (delegation.status === 'running') {
    return 'running';
  }

  if (delegation.status === 'cancelled' || delegation.outcome === 'interrupted') {
    return 'cancelled';
  }

  if (delegation.outcome === 'error') {
    return 'failed';
  }

  if (delegation.outcome === 'max_steps') {
    return 'stepLimit';
  }

  return delegation.outcome === 'done' ? 'done' : 'finished';
}
