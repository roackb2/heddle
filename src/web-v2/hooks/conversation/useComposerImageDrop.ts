import { useCallback, useMemo, useState, type DragEventHandler } from 'react';

type UseComposerImageDropArgs = {
  disabled?: boolean;
  onUploadImages: (files: FileList) => void;
};

export function useComposerImageDrop({
  disabled,
  onUploadImages,
}: UseComposerImageDropArgs) {
  const [dragActive, setDragActive] = useState(false);

  const onDragEnter: DragEventHandler<HTMLFormElement> = useCallback((event) => {
    if (!canAcceptImageDrop(event.dataTransfer, disabled)) {
      return;
    }

    event.preventDefault();
    setDragActive(true);
  }, [disabled]);

  const onDragOver: DragEventHandler<HTMLFormElement> = useCallback((event) => {
    if (!canAcceptImageDrop(event.dataTransfer, disabled)) {
      return;
    }

    event.preventDefault();
  }, [disabled]);

  const onDragLeave: DragEventHandler<HTMLFormElement> = useCallback(() => {
    setDragActive(false);
  }, []);

  const onDrop: DragEventHandler<HTMLFormElement> = useCallback((event) => {
    setDragActive(false);
    if (!canAcceptImageDrop(event.dataTransfer, disabled)) {
      return;
    }

    event.preventDefault();
    onUploadImages(event.dataTransfer.files);
  }, [disabled, onUploadImages]);

  const dropZoneProps = useMemo(() => ({
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  }), [onDragEnter, onDragLeave, onDragOver, onDrop]);

  return {
    dragActive,
    dropZoneProps,
  };
}

function canAcceptImageDrop(dataTransfer: DataTransfer, disabled?: boolean) {
  return !disabled && Array.from(dataTransfer.types).includes('Files');
}
