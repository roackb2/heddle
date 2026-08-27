import { useId } from 'react';
import { Network } from 'lucide-react';
import { Switch } from '@web/components/ui/switch';
import { useI18n } from '@web/i18n';

type ComposerSubagentControlProps = {
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
};

/** Local next-turn preference; delegation policy remains owned by the runtime. */
export function ComposerSubagentControl({
  enabled,
  disabled,
  onEnabledChange,
}: ComposerSubagentControlProps) {
  const { t } = useI18n();
  const switchId = useId();
  const status = t(enabled ? 'composer.subagents.enabled' : 'composer.subagents.disabled');

  return (
    <div className="v2-subagents-menu-section">
      <div className="v2-drift-menu-row">
        <Network aria-hidden="true" data-icon="inline-start" className="v2-drift-menu-icon" />
        <label htmlFor={switchId} className="v2-drift-menu-copy">
          <span className="v2-drift-menu-title">{t('composer.subagents.title')}</span>
          <span className="v2-drift-menu-status">{status}</span>
        </label>
        <Switch
          id={switchId}
          checked={enabled}
          disabled={disabled}
          aria-label={`${t('composer.subagents.ariaLabel')}: ${status}`}
          onCheckedChange={onEnabledChange}
        />
      </div>
      <p className="v2-drift-menu-note text-pretty">{t('composer.subagents.description')}</p>
    </div>
  );
}
