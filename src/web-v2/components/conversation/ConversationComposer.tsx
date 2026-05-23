import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import type { ControlPlaneModelOptions } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { Textarea } from '@web/components/ui/textarea';
import type { ControlPlaneReasoningEffortSelection } from '@web/hooks/useControlPlaneSessionDetail';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';

const composerTextareaMinHeight = 28;
const composerTextareaMaxHeight = 176;

const reasoningEfforts = [
  { value: 'default', labelKey: 'composer.reasoning.default' },
  { value: 'low', labelKey: 'composer.reasoning.low' },
  { value: 'medium', labelKey: 'composer.reasoning.medium' },
  { value: 'high', labelKey: 'composer.reasoning.high' },
  { value: 'ultrahigh', labelKey: 'composer.reasoning.ultrahigh' },
] satisfies Array<{ value: ControlPlaneReasoningEffortSelection; labelKey: I18nMessageKey }>;

// ConversationComposer owns the prompt draft and visual controls. Session
// settings are API-backed by the parent session workflow.
export function ConversationComposer({
  disabled,
  model,
  modelOptions,
  reasoningEffort,
  settingsUpdating,
  settingsError,
  submitting,
  onSubmitPrompt,
  onUpdateModel,
  onUpdateReasoningEffort,
}: {
  disabled?: boolean;
  model?: string;
  modelOptions?: ControlPlaneModelOptions;
  reasoningEffort?: Exclude<ControlPlaneReasoningEffortSelection, 'default'>;
  settingsUpdating?: boolean;
  settingsError?: string;
  submitting?: boolean;
  onSubmitPrompt: (prompt: string) => Promise<void>;
  onUpdateModel?: (model: string) => Promise<void>;
  onUpdateReasoningEffort?: (value: ControlPlaneReasoningEffortSelection) => Promise<void>;
}) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = `${composerTextareaMinHeight}px`;
    const nextHeight = Math.min(textarea.scrollHeight, composerTextareaMaxHeight);
    textarea.style.height = `${Math.max(nextHeight, composerTextareaMinHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > composerTextareaMaxHeight ? 'auto' : 'hidden';
  }, [draft]);

  const sendDisabled = disabled || submitting || !draft.trim();

  async function handleSubmit() {
    const prompt = draft.trim();
    if (!prompt || sendDisabled) {
      return;
    }

    setDraft('');
    await onSubmitPrompt(prompt);
  }

  return (
    <form
      className="v2-composer-shell"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <Textarea
        ref={textareaRef}
        aria-label={t('composer.promptAriaLabel')}
        className="v2-composer-textarea"
        disabled={disabled || submitting}
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="on"
        enterKeyHint="send"
        inputMode="text"
        placeholder={t('composer.placeholder')}
        rows={1}
        spellCheck
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
      />
      <div className="v2-composer-toolbar">
        <Button
          type="button"
          variant="ghost"
          size="none"
          className="v2-composer-icon-button"
          aria-label={t('composer.addContext')}
        >
          <Plus aria-hidden="true" />
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <ModelSelect
            ariaLabel={t('composer.model')}
            disabled={disabled || settingsUpdating || !onUpdateModel}
            options={modelOptions}
            value={model}
            onValueChange={(value) => {
              void onUpdateModel?.(value);
            }}
          />
          <ReasoningEffortSelect
            ariaLabel={t('composer.reasoningEffort')}
            disabled={disabled || settingsUpdating || !onUpdateReasoningEffort}
            value={reasoningEffort ?? 'default'}
            onValueChange={(value) => {
              void onUpdateReasoningEffort?.(value);
            }}
          />
          <Button
            type="submit"
            size="none"
            className="v2-composer-send-button"
            aria-label={t('composer.send')}
            disabled={sendDisabled}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
      </div>
      {settingsError ? <p className="v2-composer-error text-pretty">{settingsError}</p> : null}
    </form>
  );
}

interface ModelSelectProps {
  value?: string;
  options?: ControlPlaneModelOptions;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  ariaLabel: string;
}

function ModelSelect({ value, options, disabled, onValueChange, ariaLabel }: ModelSelectProps) {
  const groups = options?.groups ?? [];
  const fallbackOptions = value ? [{
    label: undefined,
    models: [value],
    options: [{ id: value, label: undefined, disabled: false, disabledReason: undefined }],
  }] : [];

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled || (!value && !groups.length)}>
      <SelectTrigger className="v2-composer-select v2-composer-model-select" aria-label={ariaLabel}>
        <SelectValue placeholder={ariaLabel} />
      </SelectTrigger>
      <SelectContent align="end" side="top" className="max-h-80 w-72">
        {(groups.length ? groups : fallbackOptions).map((group) => (
          <div key={group.label ?? group.models.join(',')}>
            {group.label ? <div className="v2-composer-select-group-label">{group.label}</div> : null}
            {group.options.map((option) => (
              <SelectItem key={option.id} value={option.id} disabled={option.disabled}>
                {option.label ?? option.id}
                {option.disabledReason ? <span className="ml-2 text-muted-foreground">{option.disabledReason}</span> : null}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ReasoningEffortSelectProps {
  value: ControlPlaneReasoningEffortSelection;
  disabled?: boolean;
  onValueChange: (value: ControlPlaneReasoningEffortSelection) => void;
  ariaLabel: string;
}

function ReasoningEffortSelect({ value, disabled, onValueChange, ariaLabel }: ReasoningEffortSelectProps) {
  const { t } = useI18n();

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as ControlPlaneReasoningEffortSelection)}
      disabled={disabled}
    >
      <SelectTrigger className="v2-composer-select v2-composer-reasoning-select" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" side="top" className="max-h-80 w-48">
        {reasoningEfforts.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {t(option.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
