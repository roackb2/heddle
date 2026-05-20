import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { LOCALE_OPTIONS, useI18n, type Locale } from '@web/i18n';

// LanguageSelect is the first settings control for v2. Keep it local to the
// navigation feature until language state needs a broader settings surface.
export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="web-v2-language-select">
        {t('language.label')}
      </label>
      <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
        <SelectTrigger id="web-v2-language-select" className="h-8 rounded-md border-border/80 bg-card">
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
