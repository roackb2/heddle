import type { LiveSessionEvent, SessionLiveEventViewUpdate } from './types';

type SessionLiveEventPresenterFn = (event: LiveSessionEvent) => SessionLiveEventViewUpdate;
type EventTypePresenterMap = Record<string, SessionLiveEventPresenterFn | undefined>;
type CompactionStatusPresenterMap = Record<NonNullable<LiveSessionEvent['status']>, SessionLiveEventPresenterFn>;

/**
 * Presents raw control-plane live events as the tiny web-v2 conversation view
 * update shape. It is intentionally browser-facing and should stay independent
 * from core runtime classes.
 */
export class SessionLiveEventPresenter {
  private static readonly eventTypePresenters: EventTypePresenterMap = {
    'assistant.stream': (event) => ({
      assistantText: event.text ?? '',
      assistantDone: event.done,
      status: event.done ? null : 'Receiving assistant response...',
    }),
    'loop.started': () => ({ running: true, status: 'Run started...' }),
    'tool.calling': (event) => ({
      status: `Working... running ${event.tool ?? 'tool'}${SessionLiveEventPresenter.formatStep(event.step)}`,
    }),
    'tool.completed': (event) => ({
      status: `${event.tool ?? 'Tool'} finished${SessionLiveEventPresenter.formatDuration(event.durationMs)}`,
    }),
    trace: (event) => SessionLiveEventPresenter.presentTraceEvent(event),
    'loop.finished': () => ({ running: false, refresh: true }),
  };

  private static readonly compactionStatusPresenters: CompactionStatusPresenterMap = {
    running: (event) => ({
      status: event.archivePath ? `Compacting earlier history... ${event.archivePath}` : 'Compacting earlier history...',
    }),
    failed: (event) => ({
      status: event.error ? `Compaction failed: ${event.error}` : 'Compaction failed.',
    }),
    finished: (event) => ({
      status: event.summaryPath ? `Compaction finished. Summary: ${event.summaryPath}` : 'Compaction finished.',
    }),
  };

  private static readonly traceEventPresenters: EventTypePresenterMap = {
    'tool.approval_requested': (event) => ({
      status: `Approval requested for ${event.event?.call?.tool ?? 'tool'}`,
    }),
    'run.finished': () => ({ running: false, refresh: true }),
  };

  static present(event: LiveSessionEvent): SessionLiveEventViewUpdate {
    const eventTypePresenter = event.type ? SessionLiveEventPresenter.eventTypePresenters[event.type] : undefined;
    if (eventTypePresenter) {
      return eventTypePresenter(event);
    }

    const compactionStatusPresenter = event.status ? SessionLiveEventPresenter.compactionStatusPresenters[event.status] : undefined;
    return compactionStatusPresenter?.(event) ?? {};
  }

  private static presentTraceEvent(event: LiveSessionEvent): SessionLiveEventViewUpdate {
    const tracePresenter = event.event?.type ? SessionLiveEventPresenter.traceEventPresenters[event.event.type] : undefined;
    return tracePresenter?.(event) ?? {};
  }

  private static formatStep(step: number | undefined): string {
    return typeof step === 'number' ? ` (step ${step})` : '';
  }

  private static formatDuration(durationMs: number | undefined): string {
    return typeof durationMs === 'number' ? ` in ${Math.round(durationMs)}ms` : '';
  }
}
