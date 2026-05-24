import { Activity } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
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
} as const;

const driftLevelMessageKeys: Record<SessionDriftLevel, string> = {
  unknown: 'composer.drift.signalUnknown',
  low: 'composer.drift.signalLow',
  medium: 'composer.drift.signalMedium',
  high: 'composer.drift.signalHigh',
};

export function SessionDriftControl({
  driftEnabled,
  driftLevel = 'unknown',
  disabled,
  updating,
  onUpdateDriftEnabled,
}: SessionDriftControlProps) {
  const { t } = useI18n();
  const actionDisabled = disabled || updating;
  const nextDriftEnabled = !driftEnabled;
  const statusLabel = t((driftEnabled ? driftMessageKeys.enabled : driftMessageKeys.disabled) as I18nMessageKey);
  const signalLabel = t(driftLevelMessageKeys[driftLevel] as I18nMessageKey);
  const triggerLabel = driftEnabled ? signalLabel : statusLabel;
  const actionLabel = updating
    ? t(driftMessageKeys.updating as I18nMessageKey)
    : t((nextDriftEnabled ? driftMessageKeys.enableAction : driftMessageKeys.disableAction) as I18nMessageKey);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="none"
          className={cn(
            'v2-drift-control',
            driftEnabled && 'v2-drift-control-enabled',
            driftEnabled && driftLevel === 'medium' && 'v2-drift-control-medium',
            driftEnabled && driftLevel === 'high' && 'v2-drift-control-high',
          )}
          aria-label={`${t(driftMessageKeys.ariaLabel as I18nMessageKey)}: ${statusLabel}, ${signalLabel}`}
          aria-pressed={driftEnabled}
          aria-busy={updating || undefined}
          disabled={disabled}
        >
          <Activity aria-hidden="true" data-icon="inline-start" />
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-64 p-2"
        aria-label={t(driftMessageKeys.ariaLabel as I18nMessageKey)}
      >
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2 px-1.5 py-1">
            <Activity aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="v2-type-nav-primary truncate text-foreground">
                {t(driftMessageKeys.title as I18nMessageKey)}
              </p>
              <p className="v2-type-caption text-pretty text-muted-foreground">
                {t(driftMessageKeys.signal as I18nMessageKey)}: {signalLabel}
              </p>
            </div>
            <span className="v2-type-caption ml-auto shrink-0 rounded-sm border border-border bg-muted/20 px-1.5 py-0.5 text-muted-foreground">
              {statusLabel}
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-between px-2.5 py-2 text-left"
            role="switch"
            aria-checked={driftEnabled}
            disabled={actionDisabled}
            onClick={() => {
              void onUpdateDriftEnabled(nextDriftEnabled);
            }}
          >
            <span className="v2-type-nav-primary truncate">{actionLabel}</span>
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-muted/30 p-0.5',
                driftEnabled && 'justify-end bg-primary',
              )}
            >
              <span className="size-4 rounded-full bg-background shadow-sm" />
            </span>
          </Button>
          <p className="v2-type-caption px-1.5 pb-1 text-pretty text-muted-foreground">
            {t(driftMessageKeys.note as I18nMessageKey)}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
