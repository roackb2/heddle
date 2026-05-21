import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { Textarea } from '@web/components/ui/textarea';
import { useI18n } from '@web/i18n';

const mockModels = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'codex-5.3', label: 'Codex 5.3' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'sonnet-4.6', label: 'Sonnet 4.6' },
  { value: 'opus-4.7', label: 'Opus 4.7' },
] as const;

const mockReasoningEfforts = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'extra-high', label: 'Extra High' },
] as const;

type MockModelValue = (typeof mockModels)[number]['value'];
type MockReasoningEffortValue = (typeof mockReasoningEfforts)[number]['value'];

const composerTextareaMinHeight = 50;
const composerTextareaMaxHeight = 176;

// ConversationComposer is visual-only for this slice. Model and reasoning
// options are local mocks until the v2 composer is wired to control-plane APIs.
export function ConversationComposer() {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<MockModelValue>('gpt-5.5');
  const [reasoningEffort, setReasoningEffort] = useState<MockReasoningEffortValue>('medium');

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

  return (
    <form className="v2-composer-shell" onSubmit={(event) => event.preventDefault()}>
      <Textarea
        ref={textareaRef}
        aria-label={t('composer.promptAriaLabel')}
        className="v2-composer-textarea"
        placeholder={t('composer.placeholder')}
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
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
          <ModelSelect value={model} onValueChange={setModel} ariaLabel={t('composer.model')} />
          <ReasoningEffortSelect
            value={reasoningEffort}
            onValueChange={setReasoningEffort}
            ariaLabel={t('composer.reasoningEffort')}
          />
          <Button
            type="submit"
            size="none"
            className="v2-composer-send-button"
            aria-label={t('composer.send')}
            disabled={!draft.trim()}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
      </div>
    </form>
  );
}

interface ModelSelectProps {
  value: MockModelValue;
  onValueChange: (value: MockModelValue) => void;
  ariaLabel: string;
}

function ModelSelect({ value, onValueChange, ariaLabel }: ModelSelectProps) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as MockModelValue)}>
      <SelectTrigger className="v2-composer-select w-[7.5rem]" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="w-56">
        {mockModels.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ReasoningEffortSelectProps {
  value: MockReasoningEffortValue;
  onValueChange: (value: MockReasoningEffortValue) => void;
  ariaLabel: string;
}

function ReasoningEffortSelect({ value, onValueChange, ariaLabel }: ReasoningEffortSelectProps) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as MockReasoningEffortValue)}>
      <SelectTrigger className="v2-composer-select w-[7rem]" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="w-44">
        {mockReasoningEfforts.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
