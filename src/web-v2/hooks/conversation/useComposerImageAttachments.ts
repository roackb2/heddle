import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ControlPlaneSessionImageUpload,
  useUploadControlPlaneSessionImagesMutation,
} from '@web/api/uploads';
import type { I18nMessageKey } from '@web/i18n';

type ComposerImageAttachmentStatus = 'uploading' | 'uploaded' | 'error';

export type ComposerImageAttachment = {
  localId: string;
  originalName: string;
  previewUrl: string;
  sizeBytes: number;
  status: ComposerImageAttachmentStatus;
  upload?: ControlPlaneSessionImageUpload;
  error?: string;
};

type UseComposerImageAttachmentsArgs = {
  sessionId?: string;
};

const imageMediaTypePrefix = 'image/';

export function useComposerImageAttachments({ sessionId }: UseComposerImageAttachmentsArgs) {
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>([]);
  const [validationError, setValidationError] = useState<I18nMessageKey | undefined>();
  const attachmentsRef = useRef<ComposerImageAttachment[]>([]);
  const {
    error: uploadError,
    isPending: uploadPending,
    mutateAsync: uploadImageFiles,
    reset: resetUploadImages,
  } = useUploadControlPlaneSessionImagesMutation();

  attachmentsRef.current = attachments;

  useEffect(() => {
    setAttachments((current) => {
      current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      return [];
    });
    setValidationError(undefined);
    resetUploadImages();
  }, [sessionId, resetUploadImages]);

  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
  }, []);

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((current) => {
      const removedAttachment = current.find((attachment) => attachment.localId === localId);
      if (removedAttachment) {
        URL.revokeObjectURL(removedAttachment.previewUrl);
      }

      return current.filter((attachment) => attachment.localId !== localId);
    });
  }, []);

  const uploadImages = useCallback(async (fileList: FileList | File[]) => {
    if (!sessionId || uploadPending) {
      return;
    }

    const files = Array.from(fileList);
    const imageFiles = files.filter((file) => file.type.startsWith(imageMediaTypePrefix));
    if (!imageFiles.length) {
      setValidationError('composer.images.imageOnly');
      return;
    }

    resetUploadImages();
    setValidationError(files.length === imageFiles.length ? undefined : 'composer.images.someSkipped');

    const pendingAttachments: ComposerImageAttachment[] = imageFiles.map((file) => ({
      localId: crypto.randomUUID(),
      originalName: file.name,
      previewUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
      status: 'uploading' as const,
    }));

    setAttachments((current) => [...current, ...pendingAttachments]);

    try {
      const uploads = await uploadImageFiles({ sessionId, files: imageFiles });
      const uploadsById = new Map(
        pendingAttachments.map((attachment, index) => [attachment.localId, uploads[index]]),
      );

      setAttachments((current) => current.map((attachment) => {
        const upload = uploadsById.get(attachment.localId);
        return upload
          ? {
              ...attachment,
              originalName: upload.originalName,
              sizeBytes: upload.sizeBytes,
              status: 'uploaded' as const,
              upload,
            }
          : pendingAttachments.some((pendingAttachment) => pendingAttachment.localId === attachment.localId)
            ? {
                ...attachment,
                status: 'error' as const,
                error: 'Upload response did not include this image.',
              }
            : attachment;
      }));
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      const failedIds = new Set(pendingAttachments.map((attachment) => attachment.localId));
      setAttachments((current) => current.map((attachment) => failedIds.has(attachment.localId)
        ? { ...attachment, status: 'error' as const, error: message }
        : attachment));
    }
  }, [sessionId, uploadImageFiles, uploadPending, resetUploadImages]);

  const uploadedPaths = useMemo(() => attachments
    .map((attachment) => attachment.upload?.path)
    .filter((path): path is string => Boolean(path)), [attachments]);

  const isUploading = uploadPending;
  const error = validationError ?? (uploadError ? 'composer.images.uploadFailed' : undefined);

  const clearUploadedAttachments = useCallback(() => {
    setAttachments((current) => {
      current
        .filter((attachment) => attachment.status === 'uploaded')
        .forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));

      return current.filter((attachment) => attachment.status !== 'uploaded');
    });
  }, []);

  return {
    attachments,
    error,
    isUploading,
    uploadedPaths,
    clearUploadedAttachments,
    removeAttachment,
    uploadImages,
  };
}
