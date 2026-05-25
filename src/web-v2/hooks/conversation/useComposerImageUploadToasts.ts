import { useErrorToasts } from '@web/hooks/useErrorToasts';
import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';

export function useComposerImageUploadToasts(error?: I18nMessageKey) {
  const { t } = useI18n();

  useErrorToasts([
    {
      key: 'composer-image-upload',
      title: t('composer.images.uploadAction'),
      error,
      formatError: (value) => (typeof value === 'string' ? t(value as I18nMessageKey) : undefined),
    },
  ]);
}
