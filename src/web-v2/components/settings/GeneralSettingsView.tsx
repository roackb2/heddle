import { LanguageSelect } from './LanguageSelect';
import { useI18n } from '@web/i18n';

export function GeneralSettingsView() {
  const { t } = useI18n();

  return (
    <div className="v2-scrollbar-hidden h-full min-w-0 overflow-auto">
      <div className="v2-settings-page mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
        <section className="min-w-0">
          <h2 className="v2-type-section-label mb-3 text-muted-foreground">{t('settings.general')}</h2>
          <div className="v2-settings-group">
            <div className="v2-settings-row">
              <div className="min-w-0">
                <p className="v2-type-nav-primary text-foreground">{t('language.label')}</p>
                <p className="v2-type-caption mt-1 text-muted-foreground">{t('generalSettings.languageDetail')}</p>
              </div>
              <div className="min-w-0">
                <LanguageSelect showLabel={false} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
