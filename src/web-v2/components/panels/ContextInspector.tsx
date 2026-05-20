import { useI18n } from '@web/i18n';

// ContextInspector owns the right-hand inspectable context region for selected
// sessions, tasks, diffs, evidence, and tool/runtime details.
export function ContextInspector() {
  const { t } = useI18n();

  return (
    <aside className="v2-panel-surface h-full min-w-0" aria-label={t('inspector.contextAriaLabel')} />
  );
}
