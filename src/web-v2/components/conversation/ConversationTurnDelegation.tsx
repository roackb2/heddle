import { memo } from 'react';
import { Network } from 'lucide-react';
import type { ClientSharedConversationTimelineDelegationGroupItem } from '@/client-shared/services/session-turn-presentation';
import { useI18n } from '@web/i18n';
import { SubagentActivityList } from './SubagentActivityList';

export const ConversationTurnDelegationGroup = memo(function ConversationTurnDelegationGroup({
  item,
}: {
  item: ClientSharedConversationTimelineDelegationGroupItem;
}) {
  const { t } = useI18n();

  return (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <section className="v2-subagent-activity-panel v2-subagent-activity-panel-settled" aria-label={t('subagents.historyLabel')}>
        <header className="v2-subagent-activity-title-row">
          <Network aria-hidden="true" />
          <span>{t('subagents.title')}</span>
          <span className="v2-subagent-activity-count tabular-nums">{item.delegations.length}</span>
        </header>
        <SubagentActivityList delegations={item.delegations} />
      </section>
    </article>
  );
});
