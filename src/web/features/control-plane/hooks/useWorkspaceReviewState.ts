import { useEffect, useState } from 'react';
import {
  fetchWorkspaceChanges,
  fetchWorkspaceFileDiff,
  type ChatTurnReview,
  type WorkspaceChanges,
  type WorkspaceFileDiff,
} from '../../../lib/api';

export function useWorkspaceReviewState({
  runActive,
  sessionUpdatedAt,
  turnReview,
  selectedReviewFilePath,
}: {
  runActive: boolean;
  sessionUpdatedAt?: string;
  turnReview: ChatTurnReview | null;
  selectedReviewFilePath?: string;
}) {
  const [workspaceChanges, setWorkspaceChanges] = useState<WorkspaceChanges | null>(null);
  const [workspaceChangesLoading, setWorkspaceChangesLoading] = useState(false);
  const [workspaceChangesError, setWorkspaceChangesError] = useState<string | undefined>();
  const [selectedWorkspaceFilePath, setSelectedWorkspaceFilePath] = useState<string | undefined>();
  const [workspaceFileDiffsByPath, setWorkspaceFileDiffsByPath] = useState<Record<string, WorkspaceFileDiff>>({});
  const [workspaceFileDiffLoading, setWorkspaceFileDiffLoading] = useState(false);
  const [workspaceFileDiffError, setWorkspaceFileDiffError] = useState<string | undefined>();
  const [workspaceReviewRefreshKey, setWorkspaceReviewRefreshKey] = useState(0);

  const selectedReviewFile =
    turnReview?.files.find((file) => file.path === selectedReviewFilePath) ?? turnReview?.files[0];
  const selectedWorkspaceFile =
    workspaceChanges?.files.find((file) => file.path === selectedWorkspaceFilePath) ?? workspaceChanges?.files[0];
  const workspaceFileDiff = selectedWorkspaceFile ? workspaceFileDiffsByPath[selectedWorkspaceFile.path] ?? null : null;
  const selectedTurnPatchIsStale = Boolean(
    selectedReviewFile?.path
    && selectedWorkspaceFile?.path === selectedReviewFile.path
    && selectedReviewFile.patch
    && workspaceFileDiff?.patch
    && normalizePatchForComparison(selectedReviewFile.patch) !== normalizePatchForComparison(workspaceFileDiff.patch),
  );

  useEffect(() => {
    let cancelled = false;
    setWorkspaceChangesLoading(true);
    async function refreshWorkspaceChanges() {
      try {
        const next = await fetchWorkspaceChanges();
        if (!cancelled) {
          setWorkspaceChanges(next);
          setWorkspaceChangesError(undefined);
          setSelectedWorkspaceFilePath((current) => (
            current && next.files.some((file) => file.path === current) ? current : next.files[0]?.path
          ));
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceChangesError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceChangesLoading(false);
        }
      }
    }

    void refreshWorkspaceChanges();

    return () => {
      cancelled = true;
    };
  }, [runActive, sessionUpdatedAt, workspaceReviewRefreshKey]);

  useEffect(() => {
    const filePaths = workspaceChanges?.files.map((file) => file.path) ?? [];
    if (!filePaths.length) {
      setWorkspaceFileDiffsByPath({});
      setWorkspaceFileDiffError(undefined);
      setWorkspaceFileDiffLoading(false);
      return;
    }

    let cancelled = false;
    setWorkspaceFileDiffLoading(true);
    async function refreshWorkspaceFileDiffs() {
      try {
        const pairs = await Promise.all(filePaths.map(async (filePath) => [
          filePath,
          await fetchWorkspaceFileDiff(filePath),
        ] as const));
        if (!cancelled) {
          setWorkspaceFileDiffsByPath(Object.fromEntries(pairs));
          setWorkspaceFileDiffError(undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceFileDiffsByPath({});
          setWorkspaceFileDiffError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setWorkspaceFileDiffLoading(false);
        }
      }
    }

    void refreshWorkspaceFileDiffs();

    return () => {
      cancelled = true;
    };
  }, [workspaceChanges, workspaceReviewRefreshKey]);

  return {
    workspaceChanges,
    workspaceChangesLoading,
    workspaceChangesError,
    selectedWorkspaceFile,
    workspaceFileDiff,
    workspaceFileDiffsByPath,
    workspaceFileDiffLoading,
    workspaceFileDiffError,
    selectedTurnPatchIsStale,
    selectWorkspaceFile: setSelectedWorkspaceFilePath,
    refreshWorkspaceReview: () => setWorkspaceReviewRefreshKey((current) => current + 1),
  };
}

function normalizePatchForComparison(patch: string): string {
  return patch.trim().replace(/\r\n/g, '\n');
}
