import { useState } from 'react';
import { Bot, Check, Globe2, ImagePlus, Plus, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import type { ControlPlaneCustomAgent, ControlPlaneCustomAgents, ControlPlanePermissionMode, ControlPlaneSessionRuntimeContext } from '@web/api/client';
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
  agents?: ControlPlaneCustomAgents;
  disabled?: boolean;
  driftEnabled: boolean;
  driftLevel: SessionDriftLevel;
  browserIntentEnabled?: boolean;
  permissionMode?: ControlPlanePermissionMode;
  permissionModeOptions?: ControlPlaneSessionRuntimeContext['permissionModeOptions'];
  selectedAgentProfileId: string;
  settingsUpdating?: boolean;
  uploadDisabled?: boolean;
  onSelectAgentProfileId: (agentProfileId: string) => void;
  onToggleBrowserIntent?: () => void;
  onUploadImagesClick?: () => void;
  onUpdateDriftEnabled?: (enabled: boolean) => Promise<void>;
  onUpdatePermissionMode?: (mode: ControlPlanePermissionMode) => Promise<void>;
};

export const BUILT_IN_COMPOSER_AGENT_IDS = {
  ask: 'builtin:ask',
  code: 'builtin:code',
  review: 'builtin:review',
} as const;

const BUILT_IN_COMPOSER_AGENT_ID_SET = new Set<string>(Object.values(BUILT_IN_COMPOSER_AGENT_IDS));
type BuiltInComposerAgentMode = keyof typeof BUILT_IN_COMPOSER_AGENT_IDS;

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

const builtInModeLabelKeys = {
  ask: 'composer.agent.mode.ask',
  code: 'composer.agent.mode.code',
  review: 'composer.agent.mode.review',
} satisfies Record<BuiltInComposerAgentMode, I18nMessageKey>;

const builtInModeDescriptionKeys = {
  ask: 'composer.agent.mode.askDescription',
  code: 'composer.agent.mode.codeDescription',
  review: 'composer.agent.mode.reviewDescription',
} satisfies Record<BuiltInComposerAgentMode, I18nMessageKey>;

const approvalLabelKeys = {
  auto: 'composer.agent.approval.auto',
  custom: 'composer.agent.approval.custom',
  interactive: 'composer.agent.approval.interactive',
  read_only: 'composer.agent.approval.readOnly',
} satisfies Record<ControlPlaneCustomAgent['approval']['preset'], I18nMessageKey>;

const toolsLabelKeys = {
  custom: 'composer.agent.tools.custom',
  default: 'composer.agent.tools.default',
  inspect: 'composer.agent.tools.inspect',
  none: 'composer.agent.tools.none',
} satisfies Record<ControlPlaneCustomAgent['tools']['preset'], I18nMessageKey>;

export function ComposerContextMenu({
  agents,
  disabled,
  driftEnabled,
  driftLevel,
  browserIntentEnabled,
  permissionMode,
  permissionModeOptions,
  selectedAgentProfileId,
  settingsUpdating,
  uploadDisabled,
  onSelectAgentProfileId,
  onToggleBrowserIntent,
  onUploadImagesClick,
  onUpdateDriftEnabled,
  onUpdatePermissionMode,
}: ComposerContextMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selectedBuiltInMode = resolveBuiltInMode(selectedAgentProfileId);
  const customAgents = agents?.agents.filter((agent) => agent.source !== 'built-in') ?? [];
  const selectedCustomAgent = customAgents.find((agent) => agent.id === selectedAgentProfileId);
  const selectedAgentLabel = selectedCustomAgent?.name
    ?? (selectedBuiltInMode ? t(builtInModeLabelKeys[selectedBuiltInMode]) : t('composer.agent.customTrigger'));
  const driftButtonLabel = driftEnabled
    ? `${t('composer.addContext')}: ${selectedAgentLabel}, ${t(driftLevelMessageKeys[driftLevel])}`
    : `${t('composer.addContext')}: ${selectedAgentLabel}`;
  const selectAgentProfile = (agentProfileId: string) => {
    onSelectAgentProfileId(agentProfileId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        {onToggleBrowserIntent ? (
          <div className="v2-browser-intent-menu-section">
            <Button
              type="button"
              variant="ghost"
              size="none"
              role="menuitemcheckbox"
              aria-checked={browserIntentEnabled ?? false}
              className="v2-browser-intent-menu-row"
              disabled={disabled}
              onClick={onToggleBrowserIntent}
            >
              <Globe2
                aria-hidden="true"
                data-icon="inline-start"
                className="v2-drift-menu-icon"
              />
              <span className="v2-drift-menu-copy">
                <span className="v2-drift-menu-title truncate">
                  {t('composer.browser.useAction')}
                </span>
                <span className="v2-drift-menu-status truncate">
                  {t('composer.browser.useDescription')}
                </span>
              </span>
              <span className="v2-composer-menu-option-check-slot" aria-hidden="true">
                {browserIntentEnabled ? <Check data-icon="inline-end" /> : null}
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
        <div className="v2-agent-menu-section">
          <div className="v2-agent-menu-header">
            <Bot
              aria-hidden="true"
              data-icon="inline-start"
              className="v2-drift-menu-icon"
            />
            <span className="v2-drift-menu-copy">
              <span className="v2-drift-menu-title truncate">
                {t('composer.agent.title')}
              </span>
              <span className="v2-drift-menu-status truncate">
                {t('composer.agent.statusPrefix')}: {selectedAgentLabel}
              </span>
            </span>
          </div>
          <div className="v2-composer-menu-options v2-agent-menu-options" aria-label={t('composer.agent.quickModesLabel')}>
            {(Object.keys(BUILT_IN_COMPOSER_AGENT_IDS) as BuiltInComposerAgentMode[]).map((mode) => {
              const agentProfileId = BUILT_IN_COMPOSER_AGENT_IDS[mode];
              const selected = selectedAgentProfileId === agentProfileId;
              return (
                <Button
                  key={mode}
                  type="button"
                  variant="ghost"
                  size="none"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={disabled}
                  className={cn(
                    'v2-composer-menu-option v2-composer-menu-option-compact',
                    selected && 'v2-composer-menu-option-selected',
                  )}
                  onClick={() => selectAgentProfile(agentProfileId)}
                >
                  <span className="v2-composer-menu-option-copy">
                    <span className="v2-composer-menu-option-label truncate">
                      {t(builtInModeLabelKeys[mode])}
                    </span>
                    <span className="v2-composer-menu-option-description truncate">
                      {t(builtInModeDescriptionKeys[mode])}
                    </span>
                  </span>
                  <span className="v2-composer-menu-option-check-slot" aria-hidden="true">
                    {selected ? <Check data-icon="inline-end" /> : null}
                  </span>
                </Button>
              );
            })}
          </div>
          <div className="v2-agent-menu-custom">
            <p className="v2-composer-menu-heading">{t('composer.agent.customMenuTitle')}</p>
            <div className="v2-composer-menu-options">
              {customAgents.length ? customAgents.map((agent) => (
                <CustomAgentMenuOption
                  agent={agent}
                  key={agent.id}
                  selected={agent.id === selectedAgentProfileId}
                  onSelect={() => selectAgentProfile(agent.id)}
                />
              )) : (
                <p className="v2-composer-menu-empty text-pretty">{t('composer.agent.emptyCustomAgents')}</p>
              )}
            </div>
            <Button asChild className="v2-composer-menu-option v2-composer-menu-option-compact" size="none" variant="ghost">
              <Link to="/settings/agents" onClick={() => setOpen(false)}>{t('composer.agent.manageAgents')}</Link>
            </Button>
          </div>
        </div>
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

function CustomAgentMenuOption({
  agent,
  onSelect,
  selected,
}: {
  agent: ControlPlaneCustomAgent;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      className={cn('v2-composer-menu-option', selected && 'v2-composer-menu-option-selected')}
      role="menuitemradio"
      aria-checked={selected}
      size="none"
      type="button"
      variant="ghost"
      onClick={onSelect}
    >
      <span className="v2-composer-menu-option-copy">
        <span className="v2-composer-menu-option-label truncate">{agent.name}</span>
        <span className="v2-composer-menu-option-description truncate">{agent.description}</span>
        <span className="v2-agent-menu-option-meta truncate">
          {t(toolsLabelKeys[agent.tools.preset])} · {t(approvalLabelKeys[agent.approval.preset])}
        </span>
      </span>
      <span className="v2-composer-menu-option-check-slot" aria-hidden="true">
        {selected ? <Check data-icon="inline-end" /> : null}
      </span>
    </Button>
  );
}

function resolveBuiltInMode(agentProfileId: string): BuiltInComposerAgentMode | undefined {
  return (Object.entries(BUILT_IN_COMPOSER_AGENT_IDS) as Array<[BuiltInComposerAgentMode, string]>)
    .find(([, id]) => id === agentProfileId)?.[0];
}

export function isBuiltInComposerAgentId(agentProfileId: string): boolean {
  return BUILT_IN_COMPOSER_AGENT_ID_SET.has(agentProfileId);
}
