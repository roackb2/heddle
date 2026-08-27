import { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import type { ClientSharedDelegationView } from '@/client-shared/services/session-delegations';
import { useI18n } from '@web/i18n';
import { SubagentActivityList } from './SubagentActivityList';

export function SubagentActivityPanel({ delegations }: { delegations: ClientSharedDelegationView[] }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const hasRunningDelegation = delegations.some((delegation) => delegation.status === 'running');

  useEffect(() => {
    if (!hasRunningDelegation) {
      return undefined;
    }

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [hasRunningDelegation]);

  return (
    <section className="v2-subagent-activity-panel" aria-label={t('subagents.liveLabel')} aria-live="polite">
      <header className="v2-subagent-activity-title-row">
        <Network aria-hidden="true" />
        <span>{t('subagents.title')}</span>
        <span className="v2-subagent-activity-count tabular-nums">{delegations.length}</span>
      </header>
      <SubagentActivityList delegations={delegations} now={now} />
    </section>
  );
}
