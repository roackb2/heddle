import { useId } from 'react';
import { Activity } from 'lucide-react';
import { Switch } from '@web/components/ui/switch';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export type SessionDriftLevel = 'unknown' | 'low' | 'medium' | 'high';

export type SessionDriftControlProps = {
  driftEnabled: boolean;
  driftLevel?: SessionDriftLevel;
  disabled?: boolean;
  updating?: boolean;
  onUpdateDriftEnabled: (enabled: boolean) => Promise<void> | void;
};

const driftMessageKeys = {
  ariaLabel: 'composer.drift.ariaLabel',
  title: 'composer.drift.title',
  enabled: 'composer.drift.enabled',
  disabled: 'composer.drift.disabled',
  signal: 'composer.drift.signal',
  note: 'composer.drift.note',
  enableAction: 'composer.drift.enableAction',
  disableAction: 'composer.drift.disableAction',
  updating: 'composer.drift.updating',
} as const satisfies Record<string, I18nMessageKey>;

const driftLevelMessageKeys = {
  unknown: 'composer.drift.signalUnknown',
  low: 'composer.drift.signalLow',
  medium: 'composer.drift.signalMedium',
  high: 'composer.drift.signalHigh',
} as const satisfies Record<SessionDriftLevel, I18nMessageKey>;

const driftLevelToneClasses = {
  unknown: 'v2-drift-status-unknown',
  low: 'v2-drift-status-low',
  medium: 'v2-drift-status-medium',
  high: 'v2-drift-status-high',
} as const satisfies Record<SessionDriftLevel, string>;

function useDriftCopy(driftEnabled: boolean, driftLevel: SessionDriftLevel, updating?: boolean) {
  const { t } = useI18n();
  const statusLabel = t(driftEnabled ? driftMessageKeys.enabled : driftMessageKeys.disabled);
  const signalLabel = t(driftLevelMessageKeys[driftLevel]);
  const nextDriftEnabled = !driftEnabled;
  const actionLabel = updating
    ? t(driftMessageKeys.updating)
    : t(nextDriftEnabled ? driftMessageKeys.enableAction : driftMessageKeys.disableAction);

  return {
    actionLabel,
    ariaLabel: t(driftMessageKeys.ariaLabel),
    note: t(driftMessageKeys.note),
    signalLabel,
    statusLabel,
    title: t(driftMessageKeys.title),
  };
}

export function SessionDriftStatusGlyph({
  driftEnabled,
  driftLevel = 'unknown',
}: Pick<SessionDriftControlProps, 'driftEnabled' | 'driftLevel'>) {
  if (!driftEnabled) {
    return null;
  }

  return (
    <Activity
      aria-hidden="true"
      data-icon="inline-end"
      className={cn('v2-drift-status-glyph', driftLevelToneClasses[driftLevel])}
    />
  );
}

export function SessionDriftMenuSection({
  driftEnabled,
  driftLevel = 'unknown',
  disabled,
  updating,
  onUpdateDriftEnabled,
}: SessionDriftControlProps) {
  const switchId = useId();
  const actionDisabled = disabled || updating;
  const copy = useDriftCopy(driftEnabled, driftLevel, updating);

  return (
    <div className="v2-drift-menu-section">
      <div className="v2-drift-menu-row">
        <Activity
          aria-hidden="true"
          data-icon="inline-start"
          className={cn('v2-drift-menu-icon', driftEnabled && driftLevelToneClasses[driftLevel])}
        />
        <label htmlFor={switchId} className="v2-drift-menu-copy">
          <span className="v2-drift-menu-title">{copy.title}</span>
          <span className="v2-drift-menu-status">
            {copy.signalLabel}
          </span>
        </label>
        <Switch
          id={switchId}
          checked={driftEnabled}
          disabled={actionDisabled}
          aria-label={`${copy.ariaLabel}: ${copy.statusLabel}, ${copy.signalLabel}`}
          aria-busy={updating || undefined}
          onCheckedChange={(checked) => {
            void onUpdateDriftEnabled(checked);
          }}
        />
      </div>
      <p className="v2-drift-menu-note text-pretty">
        {copy.note}
      </p>
    </div>
  );
}
