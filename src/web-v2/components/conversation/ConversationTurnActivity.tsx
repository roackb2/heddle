import { memo } from 'react';
import type { ClientSharedConversationTimelineActivityGroupItem } from '@/client-shared/services/session-turn-presentation';

const MAX_DIFF_LINES = 120;
type ConversationTurnActivity = ClientSharedConversationTimelineActivityGroupItem['activities'][number];

const approvalLabels: Record<string, string> = {
  approved: 'Approved',
  denied: 'Denied',
  requested: 'Approval requested',
};

const editActionLabels: Record<string, string> = {
  create: 'Created',
  delete: 'Deleted',
  replace: 'Edited',
  update: 'Edited',
};

export const ConversationTurnActivityGroup = memo(function ConversationTurnActivityGroup({
  item,
}: {
  item: ClientSharedConversationTimelineActivityGroupItem;
}) {
  return (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <details className="v2-turn-activity-group">
        <summary className="v2-turn-activity-summary-row">
          <span className="v2-turn-activity-title">Agent tool activities</span>
          <span className="v2-turn-activity-meta">{formatActivityCount(item.activities.length)}</span>
        </summary>
        <div className="v2-turn-activity-details">
          {item.activities.map((activity) => (
            <ActivityDetail key={activity.id} activity={activity} />
          ))}
        </div>
      </details>
    </article>
  );
});

function ActivityDetail({ activity }: { activity: ConversationTurnActivity }) {
  if (activity.type === 'approval') {
    return <ApprovalActivity activity={activity} />;
  }

  return <EditDiffActivity activity={activity} />;
}

function ApprovalActivity({ activity }: { activity: ConversationTurnActivity }) {
  if (activity.type !== 'approval') {
    return null;
  }

  return (
    <section className="v2-turn-activity-detail" data-activity-type="approval" data-activity-status={activity.status}>
      <header className="v2-turn-activity-header">
        <span className="v2-turn-activity-title">{approvalLabels[activity.status]}</span>
        <span className="v2-turn-activity-meta">{activity.tool}</span>
      </header>
      <p className="v2-turn-activity-copy">{activity.summary}</p>
      {activity.command ? <pre className="v2-turn-activity-command">{activity.command}</pre> : null}
      {activity.reason ? <p className="v2-turn-activity-muted">{activity.reason}</p> : null}
    </section>
  );
}

function EditDiffActivity({ activity }: { activity: ConversationTurnActivity }) {
  if (activity.type !== 'edit_diff') {
    return null;
  }

  const lines = activity.patch.split('\n');
  const visibleLines = lines.slice(0, MAX_DIFF_LINES);
  const truncated = activity.truncated || lines.length > visibleLines.length;

  return (
    <section className="v2-turn-activity-detail" data-activity-type="edit-diff">
      <header className="v2-turn-activity-header">
        <span className="v2-turn-activity-title">Edit diff</span>
        <span className="v2-turn-activity-meta">{formatEditMeta(activity.action)}</span>
      </header>
      <div className="v2-turn-activity-path">{activity.path}</div>
      <pre className="v2-turn-activity-diff" aria-label={`Diff for ${activity.path}`}>
        {visibleLines.map((line, index) => (
          <span key={`${activity.id}:${index}`} className={resolveDiffLineClass(line)}>
            {line || ' '}
            {'\n'}
          </span>
        ))}
      </pre>
      {truncated ? <p className="v2-turn-activity-muted">Diff preview truncated.</p> : null}
    </section>
  );
}

function formatActivityCount(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

function formatEditMeta(action: string | undefined): string {
  if (!action) {
    return '';
  }

  return editActionLabels[action] ?? action;
}

function resolveDiffLineClass(line: string): string {
  if (line.startsWith('@@')) {
    return 'v2-turn-activity-diff-line v2-turn-activity-diff-line-hunk';
  }

  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'v2-turn-activity-diff-line v2-turn-activity-diff-line-added';
  }

  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'v2-turn-activity-diff-line v2-turn-activity-diff-line-removed';
  }

  return 'v2-turn-activity-diff-line';
}
