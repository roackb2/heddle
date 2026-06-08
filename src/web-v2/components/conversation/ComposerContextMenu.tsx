import { Check, ImagePlus, Plus, ShieldCheck } from 'lucide-react';
import type { ControlPlanePermissionMode, ControlPlaneSessionRuntimeContext } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';
import {
  SessionDriftMenuSection,
  SessionDriftStatusGlyph,
  type SessionDriftLevel,
} from './SessionDriftControl';

type ComposerContextMenuProps = {
  disabled?: boolean;
  driftEnabled: boolean;
  driftLevel: SessionDriftLevel;
  permissionMode?: ControlPlanePermissionMode;
  permissionModeOptions?: ControlPlaneSessionRuntimeContext['permissionModeOptions'];
  settingsUpdating?: boolean;
  uploadDisabled?: boolean;
  onUploadImagesClick?: () => void;
  onUpdateDriftEnabled?: (enabled: boolean) => Promise<void>;
  onUpdatePermissionMode?: (mode: ControlPlanePermissionMode) => Promise<void>;
};

const driftLevelMessageKeys = {
  unknown: 'composer.drift.signalUnknown',
  low: 'composer.drift.signalLow',
  medium: 'composer.drift.signalMedium',
  high: 'composer.drift.signalHigh',
} as const satisfies Record<SessionDriftLevel, I18nMessageKey>;

const permissionModeLabelKeys = {
  default: 'composer.permissionMode.default.label',
  auto: 'composer.permissionMode.auto.label',
  custom: 'composer.permissionMode.custom.label',
} as const satisfies Record<ControlPlanePermissionMode, I18nMessageKey>;

const permissionModeDescriptionKeys = {
  default: 'composer.permissionMode.default.description',
  auto: 'composer.permissionMode.auto.description',
  custom: 'composer.permissionMode.custom.description',
} as const satisfies Record<ControlPlanePermissionMode, I18nMessageKey>;

export function ComposerContextMenu({
  disabled,
  driftEnabled,
  driftLevel,
  permissionMode,
  permissionModeOptions,
  settingsUpdating,
  uploadDisabled,
  onUploadImagesClick,
  onUpdateDriftEnabled,
  onUpdatePermissionMode,
}: ComposerContextMenuProps) {
  const { t } = useI18n();
  const driftButtonLabel = driftEnabled
    ? `${t('composer.addContext')}: ${t(driftLevelMessageKeys[driftLevel])}`
    : t('composer.addContext');

  return (
    <Popover>
      <span className="v2-composer-context-cluster">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="none"
            className="v2-composer-context-button"
            aria-label={driftButtonLabel}
            disabled={disabled}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
          </Button>
        </PopoverTrigger>
        <span className="v2-composer-context-status">
          <SessionDriftStatusGlyph
            driftEnabled={driftEnabled}
            driftLevel={driftLevel}
          />
        </span>
      </span>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="v2-composer-menu v2-composer-context-menu"
        aria-label={t('composer.contextMenu')}
      >
        {onUploadImagesClick ? (
          <div className="v2-upload-menu-section">
            <Button
              type="button"
              variant="ghost"
              size="none"
              className="v2-upload-menu-row"
              disabled={disabled || uploadDisabled}
              onClick={onUploadImagesClick}
            >
              <ImagePlus
                aria-hidden="true"
                data-icon="inline-start"
                className="v2-drift-menu-icon"
              />
              <span className="v2-drift-menu-copy">
                <span className="v2-drift-menu-title truncate">
                  {t('composer.images.uploadAction')}
                </span>
                <span className="v2-drift-menu-status truncate">
                  {t('composer.images.uploadDescription')}
                </span>
              </span>
            </Button>
          </div>
        ) : null}
        {onUpdatePermissionMode && permissionModeOptions?.length ? (
          <div className="v2-permission-mode-menu-section">
            <div className="v2-permission-mode-menu-header">
              <ShieldCheck
                aria-hidden="true"
                data-icon="inline-start"
                className="v2-drift-menu-icon"
              />
              <span className="v2-drift-menu-copy">
                <span className="v2-drift-menu-title truncate">
                  {t('composer.permissionMode.title')}
                </span>
                <span className="v2-drift-menu-status truncate">
                  {t('composer.permissionMode.statusPrefix')}: {t(permissionModeLabelKeys[permissionMode ?? 'default'])}
                </span>
              </span>
            </div>
            <div className="v2-composer-menu-options v2-permission-mode-menu-options">
              {permissionModeOptions.map((option) => {
                const selected = option.id === (permissionMode ?? 'default');
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant="ghost"
                    size="none"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={disabled || settingsUpdating || option.disabled}
                    className={cn(
                      'v2-composer-menu-option v2-composer-menu-option-compact',
                      selected && 'v2-composer-menu-option-selected',
                    )}
                    onClick={() => {
                      void onUpdatePermissionMode(option.id);
                    }}
                  >
                    <span className="v2-composer-menu-option-copy">
                      <span className="v2-composer-menu-option-label truncate">
                        {t(permissionModeLabelKeys[option.id])}
                      </span>
                      <span className="v2-composer-menu-option-description truncate">
                        {option.disabledReason ?? t(permissionModeDescriptionKeys[option.id])}
                      </span>
                    </span>
                    <span className="v2-composer-menu-option-check-slot" aria-hidden="true">
                      {selected ? <Check data-icon="inline-end" /> : null}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}
        {onUpdateDriftEnabled ? (
          <SessionDriftMenuSection
            disabled={disabled || settingsUpdating}
            driftEnabled={driftEnabled}
            driftLevel={driftLevel}
            updating={settingsUpdating}
            onUpdateDriftEnabled={onUpdateDriftEnabled}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
