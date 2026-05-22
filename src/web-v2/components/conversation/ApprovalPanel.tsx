import { BookmarkCheck, Check, ShieldAlert, XCircle } from 'lucide-react';
import type { ControlPlaneApprovalDecision, ControlPlanePendingApproval } from '@web/hooks/useControlPlaneSessionDetail';
import { Button } from '@web/components/ui/button';
import { useI18n } from '@web/i18n';

type PendingApproval = NonNullable<ControlPlanePendingApproval>;

type ApprovalPanelProps = {
  approval: PendingApproval;
  resolving: boolean;
  error?: string;
  onResolve: (decision: ControlPlaneApprovalDecision) => Promise<void>;
};

export function ApprovalPanel({ approval, resolving, error, onResolve }: ApprovalPanelProps) {
  const { t } = useI18n();
  const detail = resolveApprovalDetail(approval.input, {
    command: t('approval.command'),
    path: t('approval.path'),
  });
  const rawPayload = detail ? undefined : formatRawPayload(approval.input);
  const rememberLabel = approval.rememberProjectApproval?.label;

  return (
    <section className="v2-approval-panel" aria-label={t('approval.ariaLabel')}>
      <div className="v2-approval-main">
        <div className="v2-approval-header">
          <ShieldAlert aria-hidden="true" className="size-4" />
          <div className="min-w-0">
            <h2 className="text-balance text-sm font-semibold text-foreground">{t('approval.title')}</h2>
            <p className="truncate text-xs text-muted-foreground">{approval.summary}</p>
          </div>
        </div>

        <dl className="v2-approval-details">
          <ApprovalMeta label={t('approval.tool')} value={approval.tool} />
          {detail ? <ApprovalMeta label={detail.label} value={detail.value} monospace /> : null}
          {approval.reason ? <ApprovalMeta label={t('approval.reason')} value={approval.reason} /> : null}
        </dl>
      </div>

      <div className="v2-approval-actions">
        <Button
          type="button"
          size="sm"
          disabled={resolving}
          onClick={() => void onResolve({ type: 'approve', reason: 'Approved in web-v2' })}
        >
          <Check aria-hidden="true" />
          {t('approval.approveOnce')}
        </Button>
        {rememberLabel ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={resolving}
            onClick={() => void onResolve({
              type: 'approve_and_remember_project',
              reason: 'Approved and remembered for this project in web-v2',
            })}
          >
            <BookmarkCheck aria-hidden="true" />
            {rememberLabel}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={resolving}
          onClick={() => void onResolve({ type: 'deny', reason: 'Denied in web-v2' })}
        >
          <XCircle aria-hidden="true" />
          {t('approval.deny')}
        </Button>
      </div>

      {approval.editPreview ? (
        <details className="v2-approval-disclosure">
          <summary>
            {approval.editPreview.action}: {approval.editPreview.path}
            {approval.editPreview.truncated ? ` (${t('approval.truncated')})` : ''}
          </summary>
          <pre className="v2-approval-code">{approval.editPreview.diff}</pre>
        </details>
      ) : null}

      {rawPayload ? (
        <details className="v2-approval-disclosure">
          <summary>{t('approval.payload')}</summary>
          <pre className="v2-approval-code">{rawPayload}</pre>
        </details>
      ) : null}

      {error ? <p className="v2-approval-error" role="alert">{error}</p> : null}
    </section>
  );
}

function ApprovalMeta({ label, value, monospace }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div className="v2-approval-meta-row">
      <dt>{label}</dt>
      <dd className={monospace ? 'font-mono' : undefined}>{value}</dd>
    </div>
  );
}

function resolveApprovalDetail(
  input: unknown,
  labels: { command: string; path: string },
): { label: string; value: string } | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (typeof record.command === 'string' && record.command.trim()) {
    return { label: labels.command, value: record.command };
  }

  if (typeof record.path === 'string' && record.path.trim()) {
    return { label: labels.path, value: record.path };
  }

  return undefined;
}

function formatRawPayload(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  const serialized = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  return serialized.length > 1600 ? `${serialized.slice(0, 1600)}...` : serialized;
}
