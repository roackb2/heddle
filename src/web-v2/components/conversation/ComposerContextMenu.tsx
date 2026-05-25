import { ImagePlus, Plus } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import {
  SessionDriftMenuSection,
  SessionDriftStatusGlyph,
  type SessionDriftLevel,
} from './SessionDriftControl';

type ComposerContextMenuProps = {
  disabled?: boolean;
  driftEnabled: boolean;
  driftLevel: SessionDriftLevel;
  settingsUpdating?: boolean;
  uploadDisabled?: boolean;
  onUploadImagesClick?: () => void;
  onUpdateDriftEnabled?: (enabled: boolean) => Promise<void>;
};

const driftLevelMessageKeys = {
  unknown: 'composer.drift.signalUnknown',
  low: 'composer.drift.signalLow',
  medium: 'composer.drift.signalMedium',
  high: 'composer.drift.signalHigh',
} as const satisfies Record<SessionDriftLevel, I18nMessageKey>;

export function ComposerContextMenu({
  disabled,
  driftEnabled,
  driftLevel,
  settingsUpdating,
  uploadDisabled,
  onUploadImagesClick,
  onUpdateDriftEnabled,
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
