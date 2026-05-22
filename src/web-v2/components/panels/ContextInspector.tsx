import { DiffPreview } from '@web/components/diff/DiffPreview';
import { useI18n } from '@web/i18n';

export function ContextInspector() {
  const { t } = useI18n();

  return (
    <aside className="v2-panel-surface h-full min-w-0 overflow-hidden" aria-label={t('inspector.contextAriaLabel')}>
      <DiffPreview />
    </aside>
  );
}
