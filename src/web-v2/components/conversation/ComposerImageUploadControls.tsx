import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@web/components/ui/button';
import type { ComposerImageAttachment } from '@web/hooks/conversation/useComposerImageAttachments';
import { useI18n } from '@web/i18n';

export type ComposerImageUploadControlsHandle = {
  openFilePicker: () => void;
};

type ComposerImageUploadControlsProps = {
  attachments: ComposerImageAttachment[];
  disabled?: boolean;
  onRemoveAttachment: (localId: string) => void;
  onUploadImages: (files: FileList) => void;
};

export const ComposerImageUploadControls = forwardRef<
  ComposerImageUploadControlsHandle,
  ComposerImageUploadControlsProps
>(function ComposerImageUploadControls({
  attachments,
  disabled,
  onRemoveAttachment,
  onUploadImages,
}, ref) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
  }), []);

  return (
    <>
      <input
        ref={fileInputRef}
        aria-label={t('composer.images.fileInputLabel')}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) {
            onUploadImages(files);
          }
          event.currentTarget.value = '';
        }}
      />
      {attachments.length ? (
        <div className="v2-composer-image-strip" aria-label={t('composer.images.attachmentsLabel')}>
          {attachments.map((attachment) => (
            <div
              key={attachment.localId}
              className="v2-composer-image-chip"
              data-status={attachment.status}
            >
              <img
                src={attachment.previewUrl}
                alt=""
                className="v2-composer-image-preview"
                draggable={false}
              />
              <span className="v2-composer-image-meta">
                <span className="v2-composer-image-name truncate">{attachment.originalName}</span>
                <span className="v2-composer-image-status truncate">
                  {attachment.status === 'uploading' ? t('composer.images.uploading') : null}
                  {attachment.status === 'uploaded' ? formatBytes(attachment.sizeBytes) : null}
                  {attachment.status === 'error' ? t('composer.images.uploadFailed') : null}
                </span>
              </span>
              {attachment.status === 'uploading' ? (
                <Loader2 aria-hidden="true" className="v2-composer-image-spinner" />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="none"
                className="v2-composer-image-remove"
                aria-label={t('composer.images.remove')}
                onClick={() => onRemoveAttachment(attachment.localId)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
});

function formatBytes(sizeBytes: number) {
  const units = [
    { label: 'GB', size: 1024 ** 3 },
    { label: 'MB', size: 1024 ** 2 },
    { label: 'KB', size: 1024 },
  ];
  const unit = units.find((candidate) => sizeBytes >= candidate.size);
  if (!unit) {
    return `${sizeBytes} B`;
  }

  const value = sizeBytes / unit.size;
  const formatted = value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${formatted} ${unit.label}`;
}
