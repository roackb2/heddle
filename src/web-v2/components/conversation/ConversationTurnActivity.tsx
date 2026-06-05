import { memo } from 'react';
import type { ClientSharedConversationTimelineActivityItem } from '@/client-shared/services/session-turn-presentation';

const MAX_DIFF_LINES = 120;

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

export const ConversationTurnActivity = memo(function ConversationTurnActivity({
  item,
}: {
  item: ClientSharedConversationTimelineActivityItem;
}) {
  if (item.activity.type === 'approval') {
    return <ApprovalActivity item={item} />;
  }

  return <EditDiffActivity item={item} />;
});

function ApprovalActivity({ item }: { item: ClientSharedConversationTimelineActivityItem }) {
  if (item.activity.type !== 'approval') {
    return null;
  }

  return (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <section className="v2-turn-activity-card" data-activity-type="approval" data-activity-status={item.activity.status}>
        <header className="v2-turn-activity-header">
          <span className="v2-turn-activity-title">{approvalLabels[item.activity.status]}</span>
          <span className="v2-turn-activity-meta">{item.activity.tool}</span>
        </header>
        <p className="v2-turn-activity-summary">{item.activity.summary}</p>
        {item.activity.command ? <pre className="v2-turn-activity-command">{item.activity.command}</pre> : null}
        {item.activity.reason ? <p className="v2-turn-activity-muted">{item.activity.reason}</p> : null}
      </section>
    </article>
  );
}

function EditDiffActivity({ item }: { item: ClientSharedConversationTimelineActivityItem }) {
  if (item.activity.type !== 'edit_diff') {
    return null;
  }

  const lines = item.activity.patch.split('\n');
  const visibleLines = lines.slice(0, MAX_DIFF_LINES);
  const truncated = item.activity.truncated || lines.length > visibleLines.length;

  return (
    <article className="v2-message-row v2-message-row-assistant" data-message-role="assistant">
      <section className="v2-turn-activity-card" data-activity-type="edit-diff">
        <header className="v2-turn-activity-header">
          <span className="v2-turn-activity-title">Edit diff</span>
          <span className="v2-turn-activity-meta">{formatEditMeta(item.activity.action)}</span>
        </header>
        <div className="v2-turn-activity-path">{item.activity.path}</div>
        <pre className="v2-turn-activity-diff" aria-label={`Diff for ${item.activity.path}`}>
          {visibleLines.map((line, index) => (
            <span key={`${item.activity.id}:${index}`} className={resolveDiffLineClass(line)}>
              {line || ' '}
              {'\n'}
            </span>
          ))}
        </pre>
        {truncated ? <p className="v2-turn-activity-muted">Diff preview truncated.</p> : null}
      </section>
    </article>
  );
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
