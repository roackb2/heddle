import { useEffect, useState } from 'react';
import { browseWorkspaceDirectories, type WorkspaceDirectoryListing } from '../../../../lib/api';

export function useWorkspacePicker({
  open,
  selectedPath,
  onOpenChange,
}: {
  open: boolean;
  selectedPath: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [browsePath, setBrowsePath] = useState<string | undefined>(selectedPath.trim() || undefined);
  const [pathInput, setPathInput] = useState(selectedPath.trim());
  const [listing, setListing] = useState<WorkspaceDirectoryListing | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialPath = selectedPath.trim() || undefined;
    setBrowsePath(initialPath);
    setPathInput(initialPath ?? '');
  }, [open, selectedPath]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    void browseWorkspaceDirectories(browsePath, includeHidden)
      .then((next) => {
        if (cancelled) {
          return;
        }
        setListing(next);
        setBrowsePath(next.path);
        setPathInput(next.path);
        setError(undefined);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, browsePath, includeHidden]);

  return {
    browsePath,
    setBrowsePath,
    pathInput,
    setPathInput,
    listing,
    error,
    loading,
    includeHidden,
    setIncludeHidden,
  };
}
