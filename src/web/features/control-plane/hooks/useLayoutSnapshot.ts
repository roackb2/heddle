import { useCallback } from 'react';
import { saveLayoutSnapshot } from '../../../lib/api';
import { captureControlPlaneLayoutSnapshot, type ScreenshotMode } from '../../../lib/debug/layoutSnapshot';
import type { ToastInput } from '../../../components/ui/use-toast';
import type { ControlPlaneSection } from '../routes';
import type { SessionsScreenState } from './useSessionsScreenState';

export function useLayoutSnapshot({
  section,
  sessionsState,
  error,
  toasts,
  notify,
}: {
  section: ControlPlaneSection;
  sessionsState: SessionsScreenState;
  error?: string;
  toasts: Array<{ title: string; tone?: ToastInput['tone'] }>;
  notify: (toast: ToastInput) => void;
}) {
  return useCallback(async (screenshot: ScreenshotMode) => {
    let snapshot: Awaited<ReturnType<typeof captureControlPlaneLayoutSnapshot>> | undefined;
    try {
      snapshot = await captureControlPlaneLayoutSnapshot({
        screenshot,
        context: {
          activeTab: section,
          selectedSessionId: sessionsState.selectedSessionId,
          selectedTurnId: sessionsState.selectedTurnId,
          runActive: sessionsState.sendingPrompt || sessionsState.runInFlight,
          pendingApproval: sessionsState.pendingApproval,
          selectedModel: sessionsState.sessionDetail?.model ?? sessionsState.activeSession?.model,
          driftEnabled: sessionsState.sessionDetail?.driftEnabled ?? sessionsState.activeSession?.driftEnabled,
          driftLevel: sessionsState.sessionDetail?.driftLevel ?? sessionsState.activeSession?.driftLevel,
          toastCount: toasts.length,
          latestToasts: toasts.map((toast) => ({ title: toast.title, tone: toast.tone })),
          errors: [error, sessionsState.sessionDetailError, sessionsState.sendPromptError, sessionsState.turnReviewError]
            .filter((candidate): candidate is string => Boolean(candidate)),
        },
      });
      const saved = await saveLayoutSnapshot(snapshot);
      notify({
        title: 'Layout snapshot saved',
        body: saved.screenshotPath ? `${saved.jsonPath}\n${saved.screenshotPath}` : saved.jsonPath,
        tone: 'success',
      });
    } catch (snapshotError) {
      const message = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
      if (snapshot) {
        downloadLayoutSnapshot(snapshot);
      }
      notify({
        title: snapshot ? 'Layout snapshot downloaded' : 'Layout snapshot failed',
        body: snapshot ? `Server save failed, downloaded locally. ${message}` : message,
        tone: snapshot ? 'info' : 'error',
      });
    }
  }, [error, notify, section, sessionsState, toasts]);
}

function downloadLayoutSnapshot(snapshot: Awaited<ReturnType<typeof captureControlPlaneLayoutSnapshot>>) {
  const timestamp = snapshot.capturedAt.replaceAll(':', '-');
  const prefix = `${timestamp}-${snapshot.appState.activeTab}`;
  downloadTextFile(`${prefix}.json`, `${JSON.stringify(snapshot, null, 2)}\n`, 'application/json');
  if (snapshot.screenshot.status === 'captured') {
    downloadDataUrl(`${prefix}.png`, snapshot.screenshot.dataUrl);
  }
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  try {
    downloadUrl(filename, url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadDataUrl(filename: string, dataUrl: string) {
  downloadUrl(filename, dataUrl);
}

function downloadUrl(filename: string, url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
