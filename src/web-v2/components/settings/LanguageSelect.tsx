import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { LOCALE_OPTIONS, useI18n, type Locale } from '@web/i18n';

interface LanguageSelectProps {
  showLabel?: boolean;
}

// LanguageSelect owns the current client locale preference for the General
// settings page until broader settings persistence is introduced.
export function LanguageSelect({ showLabel = true }: LanguageSelectProps) {
  const { locale, setLocale, t } = useI18n();
  const labelId = 'web-v2-language-select-label';

  return (
    <div className="grid gap-2">
      {showLabel ? (
        <label id={labelId} className="v2-type-section-label text-muted-foreground" htmlFor="web-v2-language-select">
          {t('language.label')}
        </label>
      ) : null}
      <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
        <SelectTrigger
          id="web-v2-language-select"
          aria-label={showLabel ? undefined : t('language.label')}
          aria-labelledby={showLabel ? labelId : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALE_OPTIONS.map((option) => (
            <SelectItem key={option.locale} value={option.locale}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
