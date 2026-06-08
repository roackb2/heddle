import type { ReactNode } from 'react';
import { useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { ControlPlaneModelOptions } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import type { ControlPlaneReasoningEffortSelection } from '@web/hooks/sessions/useControlPlaneSessionDetail';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export type ComposerReasoningEffortSelection = Exclude<ControlPlaneReasoningEffortSelection, 'default'>;

type ComposerExecutionMenuProps = {
  model?: string;
  modelOptions?: ControlPlaneModelOptions;
  reasoningEffort: ComposerReasoningEffortSelection;
  disabled?: boolean;
  settingsUpdating?: boolean;
  onUpdateModel?: (model: string) => Promise<void>;
  onUpdateReasoningEffort?: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
};

const reasoningEfforts = [
  { value: 'low', labelKey: 'composer.reasoning.low' },
  { value: 'medium', labelKey: 'composer.reasoning.medium' },
  { value: 'high', labelKey: 'composer.reasoning.high' },
  { value: 'ultrahigh', labelKey: 'composer.reasoning.ultrahigh' },
] as const satisfies Array<{ value: ComposerReasoningEffortSelection; labelKey: I18nMessageKey }>;

export function ComposerExecutionMenu({
  model,
  modelOptions,
  reasoningEffort,
  disabled,
  settingsUpdating,
  onUpdateModel,
  onUpdateReasoningEffort,
}: ComposerExecutionMenuProps) {
  const { t } = useI18n();
  const [modelSearch, setModelSearch] = useState('');
  const groups = modelOptions?.groups ?? [];
  const fallbackOptions = model ? [{
    label: undefined,
    models: [model],
    options: [{ id: model, label: undefined, disabled: false, disabledReason: undefined }],
  }] : [];
  const modelGroups = groups.length ? groups : fallbackOptions;
  const modelSearchQuery = modelSearch.trim().toLowerCase();
  const modelOptionCount = modelGroups.reduce((count, group) => count + group.options.length, 0);
  const showModelSearch = modelOptionCount > 6 || Boolean(modelSearchQuery);
  const filteredModelGroups = modelSearchQuery
    ? modelGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => [
          group.label,
          option.id,
          option.label,
        ].some((value) => value?.toLowerCase().includes(modelSearchQuery))),
      }))
      .filter((group) => group.options.length)
    : modelGroups;
  const reasoningLabel = t(reasoningEfforts.find((option) => option.value === reasoningEffort)?.labelKey ?? 'composer.reasoning.medium');
  const modelLabel = model ?? t('composer.model');
  const triggerLabel = `${modelLabel} · ${reasoningLabel}`;
  const triggerDisabled = disabled || settingsUpdating || (!onUpdateModel && !onUpdateReasoningEffort);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="none"
          className="v2-composer-execution-trigger"
          aria-label={`${t('composer.executionMenu')}: ${triggerLabel}`}
          aria-busy={settingsUpdating || undefined}
          disabled={triggerDisabled}
        >
          <span className="v2-composer-execution-label truncate">
            {triggerLabel}
          </span>
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="v2-composer-menu v2-composer-execution-menu"
        aria-label={t('composer.executionMenu')}
      >
        <div className="v2-composer-menu-section">
          <p className="v2-composer-menu-heading">
            {t('composer.reasoningEffort')}
          </p>
          <div className="v2-composer-menu-options">
            {reasoningEfforts.map((option) => (
              <ComposerMenuOption
                key={option.value}
                compact
                selected={reasoningEffort === option.value}
                disabled={!onUpdateReasoningEffort || settingsUpdating}
                onSelect={() => {
                  void onUpdateReasoningEffort?.(option.value);
                }}
              >
                {t(option.labelKey)}
              </ComposerMenuOption>
            ))}
          </div>
        </div>
        <div className="v2-composer-menu-section">
          <p className="v2-composer-menu-heading">
            {t('composer.model')}
          </p>
          {showModelSearch ? (
            <label className="v2-composer-model-search">
              <Search aria-hidden="true" data-icon="inline-start" />
              <input
                type="text"
                className="v2-composer-model-search-input"
                value={modelSearch}
                placeholder={t('composer.searchModels')}
                aria-label={t('composer.searchModels')}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => {
                  setModelSearch(event.target.value);
                }}
              />
            </label>
          ) : null}
          <div className="v2-composer-menu-options">
            {filteredModelGroups.map((group) => (
              <div key={group.label ?? group.models.join(',')} className="v2-composer-menu-option-group">
                {group.label ? (
                  <p className="v2-composer-menu-group-heading">
                    {group.label}
                  </p>
                ) : null}
                {group.options.map((option) => (
                  <ComposerMenuOption
                    key={option.id}
                    selected={model === option.id}
                    disabled={!onUpdateModel || settingsUpdating || option.disabled}
                    description={option.disabledReason}
                    onSelect={() => {
                      void onUpdateModel?.(option.id);
                    }}
                  >
                    {option.label ?? option.id}
                  </ComposerMenuOption>
                ))}
              </div>
            ))}
            {filteredModelGroups.length ? null : (
              <p className="v2-composer-menu-empty text-pretty">
                {t('composer.noModelMatches')}
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ComposerMenuOption({
  children,
  description,
  compact,
  selected,
  disabled,
  onSelect,
}: {
  children: ReactNode;
  description?: string;
  compact?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="none"
      className={cn(
        'v2-composer-menu-option text-left',
        compact && 'v2-composer-menu-option-compact',
        selected && 'v2-composer-menu-option-selected',
      )}
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="v2-composer-menu-option-copy">
        <span className="v2-composer-menu-option-label truncate">
          {children}
        </span>
        {description ? (
          <span className="v2-composer-menu-option-description truncate">
            {description}
          </span>
        ) : null}
      </span>
      <span className="v2-composer-menu-option-check-slot" aria-hidden="true">
        {selected ? <Check data-icon="inline-end" /> : null}
      </span>
    </Button>
  );
}
